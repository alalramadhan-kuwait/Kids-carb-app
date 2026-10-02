#!/usr/bin/env python3
"""
Import a Gluroo data export (CSV) into the carb schema. Prints SQL to stdout and a review report to stderr.

    python3 scripts/gluroo_import.py export.csv MEMBER_UUID > import.sql 2> review.md

Safe to run again on a newer export: readings skip times already covered, events use stable client ids,
meals use a stable source_key.

What it does
  cgm_reading           -> glucose_readings (only where no reading exists within 90 s), Libre's arrow kept
  DOSE_INSULIN          -> insulin event, rapid; 'meal' if food was logged from 20 min before to 45 min after, else 'correction'
  DOSE_BASAL_*          -> insulin event, long (a second basal within 2 h is reported, not imported)
  BGL_FP_READING        -> bg_check event
  INTERVENTION          -> treatment event
  ANNOUNCE_MEAL         -> meal_history, after removing re-estimates: the same food logged again within
                           30 min is a corrected estimate, so only the last one is kept. Items within
                           20 min of each other become one meal. A juice or sweet of 20 g or less while
                           glucose is under 4.4 mmol/L (80 mg/dL) is imported as a low treatment instead.
  anything already logged in the app (same kind and amount within 15 min) is skipped.
"""
import csv, json, re, sys, uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta

NS = uuid.UUID('6f1c1d3e-3b9e-4e55-9b8a-6c1a0d0f2a11')
KW = timedelta(hours=3)
SENDERS = {'422380': 'الأب', '422389': 'Rawan', '422378': 'Layan'}

# canonical foods: (key, Arabic name, kind) matched by keywords in Gluroo's description (first match wins)
FOODS = [
    ('cocktail', 'عصير كوكتيل فواكه', 'snack', [r'cocktail fruit drink']),
    ('juice_box', 'عصير علبة', 'snack', [r'made from juice concentrate', r'nutrition facts for a juice box']),
    ('mango', 'عصير مانجو', 'snack', [r'mango nectar']),
    ('kdd_choc', 'حليب KDD بالشوكولاتة', 'snack', [r'kdd']),
    ('mint_milk', 'حليب بالنعناع', 'snack', [r'flavored milk drink']),
    ('egg_sandwich', 'ساندويتش بيض وتركي وجبن', 'meal', [r'sandwich.*(egg|turkey)']),
    ('chicken_sandwich', 'ساندويتش دجاج', 'meal', [r'chicken sandwiches|burgers']),
    ('tea', 'شاي بالحليب والسكر', 'snack', [r'tea']),
    ('spinach_rice', 'عيش مع مرق سبانخ', 'meal', [r'spinach']),
    ('rice', 'عيش أبيض', 'meal', [r'rice|vermicelli']),
    ('stew', 'مرق دجاج وبطاط', 'meal', [r'stew|curry']),
    ('skewers', 'تكة دجاج', 'meal', [r'skewer|tikka']),
    ('meat_plate', 'لحم مشوي', 'meal', [r'cooked meat']),
    ('meat_sauce', 'لحم بصلصة طماط', 'meal', [r'thick red sauce']),
    ('ice_cream', 'آيس كريم', 'snack', [r'ice cream']),
    ('eggs', 'بيض مسلوق', 'snack', [r'\begg']),
    ('turkey', 'شرائح تركي وخيار', 'snack', [r'deli meat|turkey or chicken deli|turkey meat']),
    ('snack_bar', 'سناك بار / بسكويت (101 سعرة)', 'snack', [r'101 per 15g|snack bar|energy 101']),
    ('cookies', 'كوكيز (حبتين)', 'snack', [r'cookie']),
    ('choc_biscuits', 'بسكويت بالشوكولاتة', 'snack', [r'biscuits with chocolate']),
    ('biscuit', 'بسكويت', 'snack', [r'biscuit']),
    ('bar55', 'بار (55 غ)', 'snack', [r'1 bar \(55g\)']),
    ('pita', 'خبز عربي', 'meal', [r'pita']),
    ('clotted_cream', 'قشطة وعسل', 'snack', [r'clotted cream']),
    ('cream_cheese_honey', 'جبن كريمي وعسل', 'snack', [r'cream cheese with honey']),
    ('cream_cheese', 'جبن كريمي', 'snack', [r'cream cheese']),
    ('cucumber', 'خيار', 'snack', [r'cucumber']),
    ('cake', 'كيك شوكولاتة', 'snack', [r'chocolate cake']),
    ('yogurt', 'روب (كوب)', 'snack', [r'yogurt']),
    ('national', 'منتج National Food (ملصق)', 'snack', [r'national food products']),
]
TREAT_KEYS = {'juice_box', 'cocktail', 'mango', 'sweet'}


def food_of(text, desc):
    s = f'{text} {desc}'.lower()
    for key, name, kind, pats in FOODS:
        if any(re.search(p, s) for p in pats):
            return key, name, kind
    return 'other:' + s[:40], text[:60], 'snack'


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def q(s):
    return 'null' if s is None else "'" + str(s).replace("'", "''") + "'"


def main(path, member):
    rows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
    for r in rows:
        r['t'] = datetime.fromisoformat(r['date'])
    rows.sort(key=lambda r: r['t'])
    report = []
    out = ['begin;']

    # existing app entries, to skip what is already logged (filled by the caller as JSON in env-free way: argv[3])
    existing = json.loads(open(sys.argv[3]).read()) if len(sys.argv) > 3 else []
    for e in existing:
        e['t'] = datetime.fromisoformat(e['t'])

    def already(kind, amount, t):
        return any(e['kind'] == kind and abs((e['t'] - t).total_seconds()) <= 900 and abs((e['amount'] or 0) - (amount or 0)) < 0.01 for e in existing)

    # ── glucose ──
    cgm = [r for r in rows if r['eventType'] == 'cgm_reading' and num(r['bgl'])]
    arrow = {'SINGLE_DOWN': 1, 'DOUBLE_DOWN': 1, 'FORTYFIVE_DOWN': 2, 'FLAT': 3, 'FORTYFIVE_UP': 4, 'SINGLE_UP': 5, 'DOUBLE_UP': 5}
    # compact: seconds after the first reading, mg/dL and arrow as three arrays
    base = int(cgm[0]['t'].timestamp())
    secs = [int(r['t'].timestamp()) for r in cgm]
    offs = ','.join(str(b - a) for a, b in zip([base] + secs, secs))  # seconds since the previous reading
    mgs = ','.join(str(int(num(r['bgl']))) for r in cgm)
    trs = ','.join(str(arrow.get(r['trend'], 'null')) for r in cgm)
    out.append(f"""insert into carb.glucose_readings (taken_at, mg_dl, trend)
select v.t, v.mg, v.tr from (select to_timestamp({base} + sum(o) over (order by n)) t, mg, tr
  from unnest(array[{offs}]::int[], array[{mgs}]::int[], array[{trs}]::smallint[]) with ordinality x(o, mg, tr, n)) v
where not exists (select 1 from carb.glucose_readings g where g.taken_at between v.t - interval '90 seconds' and v.t + interval '90 seconds')
on conflict (taken_at) do nothing;""")
    glucose = [(r['t'], num(r['bgl']), arrow.get(r['trend'])) for r in cgm]

    def bg_at(t, within=600):
        best = min(glucose, key=lambda g: abs((g[0] - t).total_seconds()), default=None)
        return best if best and abs((best[0] - t).total_seconds()) <= within else None

    report.append(f'## Glucose\n{len(cgm)} readings, {cgm[0]["t"] + KW:%d %b %H:%M} – {cgm[-1]["t"] + KW:%d %b %H:%M} (Kuwait). Only times not already covered are added.\n')

    msgs = [r for r in rows if r['eventType'] == 'message']
    meals = [r for r in msgs if r['msgType'] == 'ANNOUNCE_MEAL' and num(r['foodG']) is not None]

    def event(kind, t, sender, extra, key):
        cid = uuid.uuid5(NS, key)
        cols = {'client_id': str(cid), 'kind': kind, 'occurred_at': t.isoformat(), 'created_by': member, 'source': 'gluroo',
                'note': f'Gluroo · {SENDERS.get(sender, sender)}', **extra}
        names = ', '.join(cols)
        values = ', '.join(q(v) if not isinstance(v, (int, float)) else str(v) for v in cols.values())
        out.append(f'insert into carb.events ({names}) values ({values}) on conflict (client_id) do nothing;')

    # ── insulin ──
    report.append('## Insulin')
    last_basal = None
    for r in msgs:
        if not (r['msgType'] == 'DOSE_INSULIN' or r['msgType'].startswith('DOSE_BASAL')):
            continue
        u = num(r['doseUnits']); t = r['t']; long = r['msgType'].startswith('DOSE_BASAL')
        when = f'{t + KW:%d %b %H:%M}'
        if already('insulin', u, t):
            report.append(f'- {when} {u:g}u {"Tresiba" if long else "rapid"}: already in the app, skipped'); continue
        if long and last_basal and (t - last_basal).total_seconds() < 7200:
            report.append(f'- **{when} Tresiba {u:g}u logged again {int((t - last_basal).total_seconds() // 60)} min after the previous one by a different person: NOT imported. Please confirm it was one dose.**'); continue
        if long:
            last_basal = t
        purpose = None
        if not long:
            near = [m for m in meals if -20 * 60 <= (m['t'] - t).total_seconds() <= 45 * 60] # a dose up to 45 min before eating
            purpose = 'meal' if near else 'correction'
        event('insulin', t, r['senderId'], {'insulin_units': u, 'insulin_type': 'long' if long else 'rapid', **({'bolus_purpose': purpose} if purpose else {})}, f"gluroo:{r['date']}:{r['msgType']}")
        report.append(f'- {when} {u:g}u {"Tresiba" if long else "rapid · " + ("meal" if purpose == "meal" else "correction")}')

    # ── finger-pricks ──
    report.append('\n## Finger-prick checks')
    for r in msgs:
        if r['msgType'] != 'BGL_FP_READING':
            continue
        mg = int(num(r['fpBgl'])); s = bg_at(r['t'])
        event('bg_check', r['t'], r['senderId'], {'bg_mgdl': mg}, f"gluroo:{r['date']}:fp")
        report.append(f"- {r['t'] + KW:%d %b %H:%M} {mg / 18.016:.1f} mmol/L (sensor then {s[1] / 18.016:.1f})" if s else f"- {r['t'] + KW:%d %b %H:%M} {mg / 18.016:.1f} mmol/L")

    # ── food: re-estimates, treatments, meals ──
    items = []
    for r in meals:
        key, name, kind = food_of(r['text'], r['description'])
        items.append({'t': r['t'], 'key': key, 'name': name, 'kind': kind, 'g': num(r['foodG']), 'fat': num(r['foodFat']), 'protein': num(r['foodProtein']),
                      'kcal': num(r['foodCal']), 'sender': r['senderId'], 'text': r['text'], 'barcode': r['description'] if r['description'].isdigit() else None, 'date': r['date']})
    for r in msgs:
        if r['msgType'] == 'INTERVENTION':
            items.append({'t': r['t'], 'key': 'sweet', 'name': r['description'] or 'حلاوة', 'kind': 'treatment', 'g': num(r['foodG']) or 0, 'fat': None, 'protein': None,
                          'kcal': num(r['foodCal']), 'sender': r['senderId'], 'text': r['text'], 'barcode': None, 'date': r['date'], 'forced_treatment': True})
    items.sort(key=lambda i: i['t'])

    report.append('\n## Food logged twice: the same food again within 30 min (a corrected estimate), or by the other parent within 60 min (the same plate) — only the last kept')
    kept = []
    for i, it in enumerate(items):
        same = lambda j: j['key'] == it['key'] and ((j['t'] - it['t']).total_seconds() <= 1800 or (j['sender'] != it['sender'] and (j['t'] - it['t']).total_seconds() <= 3600))
        later = [j for j in items[i + 1:] if same(j)]
        if later:
            who = '' if later[-1]['sender'] == it['sender'] else f" by {SENDERS.get(later[-1]['sender'], '?')}"
            report.append(f"- {it['t'] + KW:%d %b %H:%M} {it['name']} {it['g']:g} g ({SENDERS.get(it['sender'], '?')}) → {later[-1]['g']:g} g at {later[-1]['t'] + KW:%H:%M}{who}")
            continue
        kept.append(it)

    report.append('\n## Low treatments (juice or sweet ≤ 20 g while glucose under 4.4)')
    food = []
    for it in kept:
        s = bg_at(it['t'])
        if already('carbs', it['g'], it['t']) or already('treatment', it['g'], it['t']):
            report.append(f"- {it['t'] + KW:%d %b %H:%M} {it['name']} {it['g']:g} g: already in the app, skipped"); continue
        if it.get('forced_treatment') or (it['key'] in TREAT_KEYS and it['g'] <= 20 and s and s[1] < 80):
            event('treatment', it['t'], it['sender'], {'carbs_g': it['g'], 'treatment': 'عصير' if it['key'] != 'sweet' else 'أخرى'}, f"gluroo:{it['date']}:treat")
            report.append(f"- {it['t'] + KW:%d %b %H:%M} {it['name']} {it['g']:g} g (sensor {s[1] / 18.016:.1f})" if s else f"- {it['t'] + KW:%d %b %H:%M} {it['name']} {it['g']:g} g")
            continue
        food.append(it)

    report.append('\n## Meals and snacks (items within 20 min grouped)')
    groups = []
    for it in food:
        if groups and (it['t'] - groups[-1][-1]['t']).total_seconds() <= 1200:
            groups[-1].append(it)
        else:
            groups.append([it])
    for g in groups:
        t = g[0]['t']; total = sum(i['g'] for i in g)
        tot = lambda k: round(sum(i[k] for i in g if i[k] is not None), 1) if any(i[k] is not None for i in g) else None
        kind = 'meal' if total >= 20 or any(i['kind'] == 'meal' for i in g) else 'snack'
        name = ' + '.join(dict.fromkeys(i['name'] for i in g))
        lines = [{'name': i['name'], 'product': None, 'quantity': 1, 'unit': 'serving', 'state': 'as_is', 'role': 'main', 'carbs': i['g']} for i in g]
        s = bg_at(t)
        key = 'gluroo:' + g[0]['date']
        notes = 'Gluroo · ' + ', '.join(dict.fromkeys(SENDERS.get(i['sender'], i['sender']) for i in g))
        out.append(f"""insert into carb.meal_history (kind, name, category, eaten_at, total_carbs, total_fat, total_protein, total_kcal, modified, lines, notes, created_by, glucose_mgdl, glucose_trend, glucose_at, source, source_key)
values ({q(kind)}, {q(name)}, 'Gluroo', {q(t.isoformat())}, {round(total, 1)}, {tot('fat') if tot('fat') is not None else 'null'}, {tot('protein') if tot('protein') is not None else 'null'}, {tot('kcal') if tot('kcal') is not None else 'null'}, true, {q(json.dumps(lines, ensure_ascii=False))}::jsonb, {q(notes)}, {q(member)}, {int(s[1]) if s else 'null'}, {s[2] if s and s[2] else 'null'}, {q(s[0].isoformat()) if s else 'null'}, 'gluroo', {q(key)})
on conflict (source_key) do nothing;""")
        report.append(f"- {t + KW:%d %b %H:%M} {kind}: {name} = {total:g} g")

    # ── repeated foods -> quick items ──
    report.append('\n## Repeated foods → quick items')
    by = defaultdict(list)
    for it in kept:
        if not it['key'].startswith('other:') and it['key'] != 'sweet':
            by[it['key']].append(it)
    for key, its in sorted(by.items(), key=lambda kv: -len(kv[1])):
        if len(its) < 2:
            continue
        carbs = Counter(round(i['g'], 1) for i in its).most_common(1)[0][0]
        last = its[-1]
        kind = 'snack' if key in TREAT_KEYS else last['kind']
        barcode = next((i['barcode'] for i in its if i['barcode']), None)
        note = f'من Gluroo: {len(its)} مرات، كارب ' + ', '.join(f"{i['g']:g}" for i in its)
        out.append(f"""insert into carb.quick_items (name, carbs, fat, protein, kcal, kind, barcode, note, source, uses, last_used)
values ({q(last['name'])}, {carbs}, {last['fat'] if last['fat'] is not None else 'null'}, {last['protein'] if last['protein'] is not None else 'null'}, {last['kcal'] if last['kcal'] is not None else 'null'}, {q(kind)}, {q(barcode)}, {q(note)}, 'gluroo', {len(its)}, {q(last['t'].isoformat())})
on conflict (name) do update set uses = excluded.uses, last_used = excluded.last_used, note = excluded.note;""")
        report.append(f"- {last['name']}: {carbs:g} g ({len(its)} times: {', '.join(f'{i[chr(103)]:g}' for i in its)})")

    out.append('commit;')
    print('\n'.join(out))
    print('\n'.join(report), file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
