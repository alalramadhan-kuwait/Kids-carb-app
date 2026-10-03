import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { isFatty } from '../engine/iob';
import { fmt, stateText, unitText } from '../lib/carbs';
import { deleteEvent, deleteHistory, restoreEvent } from '../lib/api';
import { EVENT_ICON, describeEvent } from '../lib/events';
import type { EventRow, HistoryEntry } from '../lib/types';
import type { IconName } from '../icons/defs';
import { formatGlucose, unitLabel } from '../lib/glucose';
import { Icon, TREND_ICON, TREND_WORDS } from '../components/Icon';
import { fmtTime } from '../lib/constants';
import { Btn, Card, Chip, Page, Sheet, cx, toast } from '../components/ui';
import { dayStartOf, dayTitle, dayTotals } from '../engine/day';
import { isEn, t, tMaybe } from '../i18n';
import { KIND_STYLE } from '../lib/kinds';
import { photoUrl, supabase } from '../lib/supabase';
import { checkMinutes } from '../engine/predict';
import { LogSheet } from '../components/LogSheet';
import { EditEntry } from '../components/EditEntry';
import { EntryActions } from '../components/EntryActions';
import { useQuickItems } from '../lib/quick';
import { brandsOf, sameBrand } from '../lib/brand';
import type { PredictionRow } from '../lib/predictions';

const DAY = 86400000;
type Kind = 'all' | 'meals' | 'insulin' | 'treatment' | 'other';
type Item = { t: number; key: string; h?: HistoryEntry; e?: EventRow };

/**
 * السجل: what was logged, newest first, grouped by day (time on each row, the day once). One row of type filters;
 * older days load on request. Tapping a row opens its details, where it can be deleted.
 */
export default function History() {
  const { history, events, reload, settings, nameOf, me } = useData();
  const [kind, setKind] = useState<Kind>('all');
  const [brand, setBrand] = useState<string | null>(null);
  const quick = useQuickItems();
  const [days, setDays] = useState(7);
  const [open, setOpen] = useState<Item | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const close = () => { setOpen(null); setEditing(false); };

  const keyOf = (h: { recipe_id: string | null; name: string }) => h.recipe_id ?? `n:${h.name}`;
  const times = useMemo(() => { const m = new Map<string, number>(); for (const h of history) m.set(keyOf(h), (m.get(keyOf(h)) ?? 0) + 1); return m; }, [history]);

  const since = dayStartOf(Date.now()) - (days - 1) * DAY;
  const all: Item[] = useMemo(() => [
    ...history.map((h) => ({ t: Date.parse(h.eaten_at), key: 'h' + h.id, h })),
    ...events.map((e) => ({ t: Date.parse(e.occurred_at), key: 'e' + e.id, e })),
  ].sort((a, b) => b.t - a.t), [history, events]);
  // brands: from logged meals and frequent foods; an older entry without a brand still matches by its food's name
  const brands = useMemo(() => brandsOf([...history.map((h) => ({ brand: h.brand ?? null })), ...quick.items]), [history, quick.items]);
  const ofBrand = useMemo(() => {
    if (!brand) return null;
    const names = quick.items.filter((q) => sameBrand(q.brand, brand)).map((q) => q.name.toLowerCase());
    const b = brand.toLowerCase();
    return (h: HistoryEntry) => sameBrand(h.brand, brand) || h.name.toLowerCase().includes(b) || names.some((n) => h.name.toLowerCase().includes(n));
  }, [brand, quick.items]);
  const match = (it: Item) => (ofBrand ? !!it.h && ofBrand(it.h) : true) && (kind === 'all' || (kind === 'meals' ? !!it.h
    : !!it.e && (kind === 'insulin' ? it.e.kind === 'insulin' : kind === 'treatment' ? it.e.kind === 'treatment' : it.e.kind !== 'insulin' && it.e.kind !== 'treatment')));
  const shown = all.filter((it) => it.t >= since && match(it));
  const older = all.some((it) => it.t < since && match(it));

  const groups = useMemo(() => {
    const m = new Map<number, Item[]>();
    for (const it of shown) { const d = dayStartOf(it.t); m.set(d, [...(m.get(d) ?? []), it]); }
    return [...m.entries()];
  }, [shown]);

  const remove = async (it: Item) => {
    close();
    if (it.e) {
      await deleteEvent(it.e.id, me); await reload();
      toast(t('حُذف التسجيل'), { label: t('تراجع'), run: async () => { await restoreEvent(it.e!.id); await reload(); } });
    } else if (it.h && confirm(t('حذف هذا التسجيل من السجل؟'))) { await deleteHistory(it.h.id); await reload(); toast(t('تم الحذف')); }
  };

  const KINDS: [Kind, string][] = [['all', t('الكل')], ['meals', t('الوجبات')], ['insulin', t('إنسولين')], ['treatment', t('علاج انخفاض')], ['other', t('أخرى')]];
  // imported entries name who logged them in the other app (in the note), not the account that imported them
  const whoOf = (it: Item) => ((it.e ?? it.h)?.source ? '' : nameOf(it.e ? it.e.created_by : (it.h as unknown as { created_by?: string }).created_by));
  return (
    <Page title={t('السجل')}>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {KINDS.map(([k, l]) => <Chip key={k} active={kind === k} onClick={() => { setKind(k); if (k !== 'all' && k !== 'meals') setBrand(null); }}>{l}</Chip>)}
      </div>
      {brands.length > 0 && (
        <div className="-mx-4 -mt-2 mb-4 flex items-center gap-1.5 overflow-x-auto px-4">
          <span className="shrink-0 text-xs font-medium text-slate-500">{t('البراند')}</span>
          <Chip active={!brand} onClick={() => setBrand(null)}>{t('الكل')}</Chip>
          {brands.map((b) => <Chip key={b} active={sameBrand(brand, b)} onClick={() => { setBrand(b); if (kind !== 'all' && kind !== 'meals') setKind('all'); }}><bdi>{b}</bdi></Chip>)}
        </div>
      )}

      <div className="space-y-5">
        {groups.map(([day, items]) => {
          const tot = dayTotals(history, events, day, day + DAY);
          return (
            <section key={day}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
                <h2 className="font-bold">{dayTitle(day)}</h2>
                <span className="text-xs text-slate-500">{[tot.carbs ? t('{g} غ كارب', { g: fmt(tot.carbs) }) : '', tot.rapid ? t('{u} وحدة سريع', { u: fmt(tot.rapid) }) : ''].filter(Boolean).join(' · ')}</span>
              </div>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
                {items.map((it) => <Row key={it.key} it={it} who={whoOf(it)} onOpen={() => { setEditing(false); setOpen(it); }} />)}
              </ul>
            </section>
          );
        })}
        {!groups.length && <Card><p className="text-slate-500">{brand ? t('لا يوجد أكل من {b} في هذه الفترة.', { b: brand }) : t('لا يوجد شيء في هذه الفترة.')}</p></Card>}
        {older && <Btn block kind="ghost" onClick={() => setDays(days + 7)}>{t('عرض أيام أقدم')}</Btn>}
        <div className="h-16" aria-hidden />{/* room so the Log button never covers the last entry */}
      </div>

      <Sheet open={!!open} onClose={close} title={editing ? t('تعديل التسجيل') : open?.h ? open.h.name : open?.e ? describeEvent(open.e) : ''}>
        {open && editing && <EditEntry e={open.e} h={open.h} onCancel={() => setEditing(false)} onDone={close} />}
        {open?.h && !editing && <MealDetail h={open.h} n={times.get(keyOf(open.h)) ?? 1} unit={settings.glucose_unit} />}
        {open?.e && !editing && (
          <div className="space-y-1 text-sm text-slate-600">
            {open.e.note && <p dir="auto" className="text-base text-slate-800">{open.e.note}</p>}
            <p>{fmtTime(new Date(open.e.occurred_at))}{open.e.source ? '' : <> · <bdi>{nameOf(open.e.created_by)}</bdi></>}</p>
          </div>
        )}
        {open && !editing && <EntryActions key={open.key} e={open.e} h={open.h} onEdit={() => setEditing(true)} onRemove={() => remove(open)} onClose={close} onOpenOther={(x) => setOpen({ t: Date.parse(x.eaten_at), key: 'h' + x.id, h: x })} />}
      </Sheet>

      {/* the same primary action as Now, in the thumb zone above the tab bar */}
      <div className={cx('pointer-events-none fixed inset-x-0 bottom-[calc(66px+env(safe-area-inset-bottom))] z-30 px-4', (logOpen || !!open) && 'hidden')}>
        <div className="mx-auto flex max-w-2xl justify-start">
          <button onClick={() => setLogOpen(true)} className="pointer-events-auto flex min-h-[50px] items-center gap-2 rounded-full bg-brand pe-5 ps-4 text-base font-bold text-white shadow-[0_8px_24px_rgba(91,72,214,0.30)] active:scale-[0.98]">
            <Icon name="plus" size={24} /> {t('سجّل')}
          </button>
        </div>
      </div>
      <LogSheet open={logOpen} onClose={() => setLogOpen(false)} />
    </Page>
  );
}

function Row({ it, who, onOpen }: { it: Item; who: string; onOpen: () => void }) {
  const icon: IconName = it.h ? 'meals' : EVENT_ICON[it.e!.kind];
  const main = it.h ? <bdi>{it.h.name}</bdi> : it.e!.kind === 'note' ? <bdi>{it.e!.note}</bdi> : describeEvent(it.e!);
  const sub = it.h ? [it.h.kind === 'snack' ? t('سناك') : '', isFatty(it.h.total_fat, it.h.total_protein) ? t('دسمة') : '', it.h.brand ?? '', it.h.needs_review ? t('خارج البحث') : '', it.h.source === 'gluroo' ? it.h.notes ?? 'Gluroo' : ''].filter(Boolean).join(' · ') : it.e!.kind !== 'note' && it.e!.note ? it.e!.note : '';
  return (
    <li>
      <button onClick={onOpen} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-start active:bg-slate-50">
        <span className="num w-[4.5rem] shrink-0 text-sm text-slate-500">{fmtTime(new Date(it.t))}</span>
        <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full', KIND_STYLE[it.h ? 'meal' : it.e!.kind].icon)}><Icon name={icon} size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{main}</span>
          {(sub || who) && <span className="block truncate text-xs text-slate-500"><bdi>{[sub, who].filter(Boolean).join(' · ')}</bdi></span>}
        </span>
        {it.h?.photo_path && <span className="shrink-0" aria-label={t('مع صورة')}>📷</span>}
        {it.h && <span className="num shrink-0 text-lg font-bold text-brand-num">{fmt(it.h.total_carbs)}<span className="text-xs font-medium"> {t('غ')}</span></span>}
        <span className="text-slate-300">{isEn() ? '›' : '‹'}</span>
      </button>
    </li>
  );
}

function MealDetail({ h, n, unit }: { h: HistoryEntry; n: number; unit: 'mmol' | 'mgdl' }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="num text-3xl font-bold text-brand-num">{fmt(h.total_carbs)}</span><span className="text-slate-500">{t('غ كارب')}</span>
        <span className="ms-auto text-slate-500">{fmtTime(new Date(h.eaten_at))}</span>
      </div>
      {h.photo_path && <a href={photoUrl(h.photo_path)!} target="_blank" rel="noreferrer"><img src={photoUrl(h.photo_path)!} alt={t('صورة الأكل')} className="max-h-56 w-full rounded-xl object-cover" /></a>}
      {h.glucose_mgdl !== null && (
        <p className="flex items-center gap-1 text-slate-600">{t('السكر عند التسجيل:')} <b className="num">{formatGlucose(h.glucose_mgdl, unit)}</b> {tMaybe(unitLabel(unit))} {h.glucose_trend ? <Icon name={TREND_ICON[h.glucose_trend]} size={14} label={tMaybe(TREND_WORDS[h.glucose_trend])} /> : null}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {h.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-2 py-1.5"><span><bdi>{l.name}</bdi> · <span className="num">{fmt(l.quantity)}</span> {unitText(l.unit)}{l.state !== 'as_is' ? ` ${stateText(l.state).toLowerCase()}` : ''}</span><span className="num font-medium">{fmt(l.carbs)}</span></li>
        ))}
      </ul>
      {h.total_kcal !== null && <p className="num text-xs text-slate-500">{t('دهون {fat}غ • ألياف {fiber}غ • بروتين {protein}غ • {kcal} سعرة', { fat: fmt(h.total_fat), fiber: fmt(h.total_fiber), protein: fmt(h.total_protein), kcal: h.total_kcal })}</p>}
      <p className="text-xs text-slate-500">{t('اختيرت {n} مرة', { n })}{h.modified ? ' · ' + t('معدّلة') : ''}</p>
      {h.needs_review && <Link to="/import" className="block rounded-xl bg-near-soft p-2.5 text-sm font-medium text-near">{t('ربما سُجّل جزء منها مرتين في Gluroo، فهي مستبعدة من البحث تلقائيًا. لا يلزم شيء منكم.')}</Link>}
      <MealPrediction id={h.id} unit={unit} />
    </div>
  );
}

/** The estimate frozen at this meal, next to what the sensor showed (prediction tracking). */
function MealPrediction({ id, unit }: { id: string; unit: 'mmol' | 'mgdl' }) {
  const [p, setP] = useState<PredictionRow | null>(null);
  useEffect(() => {
    let live = true;
    supabase.from('predictions').select('*').eq('key', 'h:' + id).maybeSingle().then(({ data }) => { if (live) setP(data as PredictionRow | null); });
    return () => { live = false; };
  }, [id]);
  if (!p) return null;
  return (
    <div className="rounded-xl bg-slate-50 p-2.5">
      <div className="mb-1 text-xs font-bold text-slate-600">{t('التقدير عند الوجبة ← الحساس')}</div>
      <ul className="space-y-0.5 text-sm">
        {checkMinutes(p.end_min).map(([k, m]) => {
          const c = p.checks[k];
          return (
            <li key={k} className="flex justify-between gap-2">
              <span className="text-slate-600">{t('بعد {h} س', { h: Math.round((m / 60) * 10) / 10 })}</span>
              <span>{!c ? t('بانتظار') : 'skip' in c ? (c.skip === 'other_entry' ? t('تسجيل آخر') : t('لا قراءة'))
                : <span className="num">{formatGlucose(c.pred, unit)} → {formatGlucose(c.actual, unit)}</span>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
