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
import { EditItems } from '../components/EditItems';
import { EntryActions } from '../components/EntryActions';
import { EntryGlance } from '../components/EntryGlance';
import { useQuickItems } from '../lib/quick';
import { brandsOf, sameBrand } from '../lib/brand';
import type { PredictionRow } from '../lib/predictions';
import type { AlertRow } from '../lib/types';
import { ALERT_NAME } from '../components/AlertStrip';
import { episodes as toEpisodes, timeline, MAIN_KINDS, type Episode } from '../engine/alarmLog';

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
  // the doctor's view: alarms with the entries, or either alone; a list or a vertical timeline
  const [view, setView] = useState<'all' | 'entries' | 'alarms'>('all');
  const [allAlarms, setAllAlarms] = useState(false);
  const [layout, setLayoutState] = useState<'list' | 'timeline'>(() => { try { return localStorage.getItem('log-layout') === 'timeline' ? 'timeline' : 'list'; } catch { return 'list'; } });
  const setLayout = (v: 'list' | 'timeline') => { setLayoutState(v); try { localStorage.setItem('log-layout', v); } catch { /* blocked */ } };
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [openEp, setOpenEp] = useState<Episode | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const quick = useQuickItems();
  const [days, setDays] = useState(7);
  const [open, setOpen] = useState<Item | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [editing, setEditing] = useState<false | 'entry' | 'items'>(false);
  const close = () => { setOpen(null); setEditing(false); };

  const keyOf = (h: { recipe_id: string | null; name: string }) => h.recipe_id ?? `n:${h.name}`;
  const times = useMemo(() => { const m = new Map<string, number>(); for (const h of history) m.set(keyOf(h), (m.get(keyOf(h)) ?? 0) + 1); return m; }, [history]);

  const since = dayStartOf(Date.now()) - (days - 1) * DAY;
  useEffect(() => {
    let live = true;
    void supabase.from('alerts').select('*').not('active_at', 'is', null).gte('started_at', new Date(since - DAY).toISOString()).order('started_at', { ascending: false })
      .then(({ data }) => { if (live) setAlerts((data ?? []) as AlertRow[]); });
    return () => { live = false; };
  }, [since]);
  const eps = useMemo(() => toEpisodes(alerts, { all: allAlarms }).filter((e) => e.start >= since), [alerts, allAlarms, since]);
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
  const shown = view === 'alarms' ? [] : all.filter((it) => it.t >= since && match(it));
  const shownEps = view === 'entries' ? [] : eps;
  const older = all.some((it) => it.t < since && match(it));

  // one list, newest first: entries and alarm episodes (list), or episodes holding their entries (timeline)
  type Row = { t: number; key: string; it?: Item; ep?: Episode; inner?: Item[] };
  const rows: Row[] = useMemo(() => layout === 'timeline'
    ? timeline(shownEps, shown).map((x) => x.kind === 'episode' ? { t: x.t, key: 'a' + x.ep.id, ep: x.ep, inner: x.entries } : { t: x.t, key: x.entry.key, it: x.entry })
    : [...shown.map((it) => ({ t: it.t, key: it.key, it })), ...shownEps.map((ep) => ({ t: ep.start, key: 'a' + ep.id, ep }))].sort((a, b) => b.t - a.t),
  [shown, shownEps, layout]);
  const groups = useMemo(() => {
    const m = new Map<number, Row[]>();
    for (const r of rows) { const d = dayStartOf(r.t); m.set(d, [...(m.get(d) ?? []), r]); }
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [rows]);

  const remove = async (it: Item) => {
    close();
    if (it.e) {
      await deleteEvent(it.e.id, me); await reload();
      toast(t('حُذف التسجيل'), { label: t('تراجع'), run: async () => { await restoreEvent(it.e!.id); await reload(); } });
    } else if (it.h && confirm(t('حذف هذا التسجيل من السجل؟'))) { await deleteHistory(it.h.id); await reload(); toast(t('تم الحذف')); }
  };

  // how many less-used filters are away from their default (shown on the Filter button)
  const extra = (brand ? 1 : 0) + (allAlarms ? 1 : 0) + (layout === 'timeline' ? 1 : 0);
  const KINDS: [Kind, string][] = [['all', t('الكل')], ['meals', t('الوجبات')], ['insulin', t('إنسولين')], ['treatment', t('علاج انخفاض')], ['other', t('أخرى')]];
  // imported entries name who logged them in the other app (in the note), not the account that imported them
  const whoOf = (it: Item) => ((it.e ?? it.h)?.source ? '' : nameOf(it.e ? it.e.created_by : (it.h as unknown as { created_by?: string }).created_by));
  return (
    <Page title={t('السجل')}>
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-sm">
        {([['all', t('الكل')], ['entries', t('المدخلات')], ['alarms', t('التنبيهات')]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={cx('min-h-[36px] rounded-full', view === k ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{l}</button>
        ))}
      </div>
      <div className="mb-4 flex items-center gap-2">
        <div className="-ms-4 flex min-w-0 flex-1 gap-2 overflow-x-auto ps-4">
          {view !== 'alarms' && KINDS.map(([k, l]) => <Chip key={k} active={kind === k} onClick={() => { setKind(k); if (k !== 'all' && k !== 'meals') setBrand(null); }}>{l}</Chip>)}
        </div>
        <button onClick={() => setFilterOpen(true)} className={cx('flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium', extra ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200 bg-white text-slate-700')}>
          {t('تصفية')}{extra > 0 && <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand px-1 text-xs font-bold text-white">{extra}</span>}
        </button>
      </div>
      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title={t('تصفية')}>
        <div className="space-y-5">
          {view !== 'entries' && (
            <div><div className="mb-2 text-sm font-bold text-slate-600">{t('التنبيهات')}</div>
              <div className="flex flex-wrap gap-2"><Chip active={!allAlarms} onClick={() => setAllAlarms(false)}>{t('التنبيهات المهمة')}</Chip><Chip active={allAlarms} onClick={() => setAllAlarms(true)}>{t('كل التنبيهات')}</Chip></div></div>
          )}
          <div><div className="mb-2 text-sm font-bold text-slate-600">{t('العرض')}</div>
            <div className="flex flex-wrap gap-2">{([['list', t('قائمة')], ['timeline', t('خط زمني')]] as const).map(([k, l]) => <Chip key={k} active={layout === k} onClick={() => setLayout(k)}>{l}</Chip>)}</div></div>
          {view !== 'alarms' && brands.length > 0 && (
            <div><div className="mb-2 text-sm font-bold text-slate-600">{t('البراند')}</div>
              <div className="flex flex-wrap gap-2"><Chip active={!brand} onClick={() => setBrand(null)}>{t('الكل')}</Chip>
                {brands.map((b) => <Chip key={b} active={sameBrand(brand, b)} onClick={() => { setBrand(b); if (kind !== 'all' && kind !== 'meals') setKind('all'); }}><bdi>{b}</bdi></Chip>)}</div></div>
          )}
          <Btn block onClick={() => setFilterOpen(false)}>{t('تم')}</Btn>
        </div>
      </Sheet>

      <div className="space-y-5">
        {groups.map(([day, items]) => {
          const tot = dayTotals(history, events, day, day + DAY);
          return (
            <section key={day}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
                <h2 className="font-bold">{dayTitle(day)}</h2>
                <span className="text-xs text-slate-500">{[tot.carbs ? t('{g} غ كارب', { g: fmt(tot.carbs) }) : '', tot.rapid ? t('{u} وحدة سريع', { u: fmt(tot.rapid) }) : ''].filter(Boolean).join(' · ')}</span>
              </div>
              {layout === 'timeline' ? (
                <ol className="relative space-y-2 ps-5 before:absolute before:inset-y-1 before:start-[7px] before:w-0.5 before:rounded-full before:bg-slate-200">
                  {items.map((r) => r.ep
                    ? <EpisodeBlock key={r.key} ep={r.ep} unit={settings.glucose_unit} who={nameOf} onOpen={() => setOpenEp(r.ep!)} withEntries={view !== 'alarms'}
                        entries={r.inner!.map((it) => ({ t: it.t, node: <Row key={it.key} it={it} who={whoOf(it)} onOpen={() => { setEditing(false); setOpen(it); }} /> }))} />
                    : <li key={r.key} className="relative overflow-hidden rounded-2xl border border-slate-100 bg-white before:absolute before:-start-[17px] before:top-6 before:h-2.5 before:w-2.5 before:rounded-full before:bg-slate-300">
                        <ul><Row it={r.it!} who={whoOf(r.it!)} onOpen={() => { setEditing(false); setOpen(r.it!); }} /></ul>
                      </li>)}
                </ol>
              ) : (
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
                  {items.map((r) => r.ep
                    ? <AlarmRow key={r.key} ep={r.ep} unit={settings.glucose_unit} who={nameOf} onOpen={() => setOpenEp(r.ep!)} />
                    : <Row key={r.key} it={r.it!} who={whoOf(r.it!)} onOpen={() => { setEditing(false); setOpen(r.it!); }} />)}
                </ul>
              )}
            </section>
          );
        })}
        {!groups.length && <Card><p className="text-slate-500">{brand ? t('لا يوجد أكل من {b} في هذه الفترة.', { b: brand }) : t('لا يوجد شيء في هذه الفترة.')}</p></Card>}
        {(older || view === 'alarms') && <Btn block kind="ghost" onClick={() => setDays(days + 7)}>{t('عرض أيام أقدم')}</Btn>}
        <div className="h-16" aria-hidden />{/* room so the Log button never covers the last entry */}
      </div>

      <Sheet open={!!openEp} onClose={() => setOpenEp(null)} title={openEp ? epTitle(openEp) : ''}>
        {openEp && <EpisodeDetail ep={openEp} unit={settings.glucose_unit} who={nameOf} />}
      </Sheet>

      <Sheet open={!!open} onClose={close} title={editing === 'items' ? t('تعديل الأصناف') : editing ? t('تعديل التسجيل') : open?.h ? open.h.name : open?.e ? describeEvent(open.e) : ''}>
        {open && editing === 'entry' && <EditEntry e={open.e} h={open.h} onCancel={() => setEditing(false)} onDone={close} />}
        {open?.h && editing === 'items' && <EditItems h={open.h} onCancel={() => setEditing(false)} onDone={close} />}
        {open?.h && !editing && <MealDetail h={open.h} n={times.get(keyOf(open.h)) ?? 1} unit={settings.glucose_unit} onEditItems={() => setEditing('items')} />}
        {open?.e && !editing && (
          <div className="space-y-2 text-sm text-slate-600">
            <EntryGlance e={open.e} />
            {open.e.note && <p dir="auto" className="text-base text-slate-800">{open.e.note}</p>}
            <p>{fmtTime(new Date(open.e.occurred_at))}{open.e.source ? '' : <> · <bdi>{nameOf(open.e.created_by)}</bdi></>}</p>
          </div>
        )}
        {open && !editing && <EntryActions key={open.key} e={open.e} h={open.h} onEdit={() => setEditing('entry')} onRemove={() => remove(open)} onClose={close} onOpenOther={(x) => setOpen({ t: Date.parse(x.eaten_at), key: 'h' + x.id, h: x })} />}
      </Sheet>

      {/* the same primary action as Now, in the thumb zone above the tab bar */}
      <div className={cx('pointer-events-none fixed inset-x-0 bottom-[calc(66px+env(safe-area-inset-bottom))] z-30 px-4 lg:bottom-8 lg:ps-[17rem] lg:pe-8', (logOpen || !!open) && 'hidden')}>
        <div className="mx-auto flex max-w-2xl justify-start lg:max-w-none lg:justify-end">
          <button onClick={() => setLogOpen(true)} className="pointer-events-auto flex min-h-[50px] items-center gap-2 rounded-full bg-brand pe-5 ps-4 text-base font-bold text-white shadow-[0_8px_24px_rgba(91,72,214,0.30)] active:scale-[0.98]">
            <Icon name="plus" size={24} /> {t('سجّل')}
          </button>
        </div>
      </div>
      <LogSheet open={logOpen} onClose={() => setLogOpen(false)} />
    </Page>
  );
}

// ── alarms ──────────────────────────────────────────────────────────────────────────────────────────
const EP_STYLE = { low: { bar: 'bg-over-fill', soft: 'bg-over-soft text-over', icon: '🔴' }, high: { bar: 'bg-near-fill', soft: 'bg-near-soft text-near', icon: '🟠' }, data: { bar: 'bg-slate-300', soft: 'bg-slate-100 text-slate-700', icon: '📡' } } as const;
// only early warnings (low expected, rising or falling fast): calmer, so a fast fall at 10 does not look like a low
const EARLY_STYLE = { low: { bar: 'bg-over-fill/40', soft: 'bg-slate-50 text-slate-700', icon: '↘' }, high: { bar: 'bg-near-fill/40', soft: 'bg-slate-50 text-slate-700', icon: '↗' } } as const;
const styleOf = (ep: Episode) => (ep.dir !== 'data' && !MAIN_KINDS.includes(ep.main) ? EARLY_STYLE[ep.dir] : EP_STYLE[ep.dir]);
/** «منخفض متوقع ← منخفض ← منخفض جدًا»: the kinds in the order they came, each once. */
const epTitle = (ep: Episode) => [...new Set(ep.alarms.map((a) => a.kind))].map((k) => tMaybe(ALERT_NAME[k])).join(' → ');
const span = (ep: Episode) => `${fmtTime(new Date(ep.start))} – ${ep.open ? t('مستمر') : fmtTime(new Date(ep.end))}`;
const ackText = (ep: Episode, who: (id: string | null) => string) => ep.ack ? `${ep.ack.ack_action === 'treated' ? t('عالجتها') : t('أنا عليها')} · ${who(ep.ack.acknowledged_by)}` : '';

function AlarmRow({ ep, unit, who, onOpen }: { ep: Episode; unit: 'mmol' | 'mgdl'; who: (id: string | null) => string; onOpen: () => void }) {
  const st = styleOf(ep);
  return (
    <li>
      <button onClick={onOpen} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-start active:bg-slate-50">
        <span className="num w-[4.5rem] shrink-0 text-sm text-slate-500">{fmtTime(new Date(ep.start))}</span>
        <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm', st.soft)} aria-hidden>{st.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{epTitle(ep)}</span>
          <span className="block truncate text-xs text-slate-500"><bdi>{[span(ep), ackText(ep, who)].filter(Boolean).join(' · ')}</bdi></span>
        </span>
        {ep.worst !== null && <span className={cx('num shrink-0 rounded-full px-2 py-0.5 text-sm font-bold', st.soft)}>{formatGlucose(ep.worst, unit)}</span>}
        <span className="text-slate-300">{isEn() ? '›' : '‹'}</span>
      </button>
    </li>
  );
}

/** Timeline: the alarm episode as a coloured block on the line, with what was done during it inside. */
function EpisodeBlock({ ep, unit, who, onOpen, withEntries, entries }: { ep: Episode; unit: 'mmol' | 'mgdl'; who: (id: string | null) => string; onOpen: () => void; withEntries: boolean; entries: { t: number; node: React.ReactNode }[] }) {
  const st = styleOf(ep);
  // in time order, with "ended" where it happened: the juice before it, the meal after it
  const ended = <li key="end" className="px-3 py-1.5 text-xs text-slate-500">✓ {t('انتهى {t}', { t: fmtTime(new Date(ep.end)) })}</li>;
  const during = entries.filter((x) => x.t <= ep.end), after = entries.filter((x) => x.t > ep.end);
  return (
    <li className="relative">
      <span aria-hidden className={cx('absolute -start-[19px] top-1 bottom-1 w-1.5 rounded-full', st.bar)} />
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        <button onClick={onOpen} className={cx('flex w-full items-center gap-2 px-3 py-2 text-start', st.soft)}>
          <span aria-hidden>{st.icon}</span>
          <span className="min-w-0 flex-1"><span className="block font-bold">{epTitle(ep)}</span><span className="block text-xs"><bdi>{[span(ep), ackText(ep, who)].filter(Boolean).join(' · ')}</bdi></span></span>
          {ep.worst !== null && <span className="num shrink-0 text-lg font-extrabold">{formatGlucose(ep.worst, unit)}</span>}
        </button>
        {withEntries && !entries.length && <p className="px-3 py-2 text-xs text-slate-500">{t('ما في تسجيل خلال التنبيه')}</p>}
        {withEntries && (entries.length > 0 || !ep.open) ? <ul className="divide-y divide-slate-100">
          {withEntries && during.map((x) => x.node)}
          {!ep.open && ended}
          {withEntries && after.map((x) => x.node)}
        </ul> : null}
      </div>
    </li>
  );
}

function EpisodeDetail({ ep, unit, who }: { ep: Episode; unit: 'mmol' | 'mgdl'; who: (id: string | null) => string }) {
  return (
    <ul className="space-y-2 text-sm">
      {ep.alarms.map((a) => (
        <li key={a.id} className="rounded-xl bg-slate-50 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2"><b>{tMaybe(ALERT_NAME[a.kind])}</b>{(a.worst_mgdl ?? a.value_mgdl) !== null && <span className="num font-bold">{formatGlucose((a.worst_mgdl ?? a.value_mgdl)!, unit)} {tMaybe(unitLabel(unit))}</span>}</div>
          <div className="text-slate-600">{fmtTime(new Date(a.started_at))} – {a.resolved_at ? fmtTime(new Date(a.resolved_at)) : t('مستمر')}</div>
          {a.acknowledged_at && <div className="text-slate-600">{a.ack_action === 'treated' ? t('عالجتها') : t('أنا عليها')} · <bdi>{who(a.acknowledged_by)}</bdi> · {fmtTime(new Date(a.acknowledged_at))}</div>}
        </li>
      ))}
    </ul>
  );
}

function Row({ it, who, onOpen }: { it: Item; who: string; onOpen: () => void }) {
  const icon: IconName = it.h ? 'meals' : EVENT_ICON[it.e!.kind];
  const main = it.h ? <bdi>{it.h.name}</bdi> : it.e!.kind === 'note' ? <bdi>{it.e!.note}</bdi> : describeEvent(it.e!);
  const sub = it.h ? [it.h.recipe_id ? t('وصفة') : '', it.h.kind === 'snack' ? t('سناك') : '', isFatty(it.h.total_fat, it.h.total_protein) ? t('دسمة') : '', it.h.brand ?? '', it.h.needs_review ? t('خارج البحث') : '', it.h.source === 'gluroo' ? it.h.notes ?? 'Gluroo' : ''].filter(Boolean).join(' · ') : it.e!.kind !== 'note' && it.e!.note ? it.e!.note : '';
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

function MealDetail({ h, n, unit, onEditItems }: { h: HistoryEntry; n: number; unit: 'mmol' | 'mgdl'; onEditItems: () => void }) {
  const { recipes } = useData();
  const recipe = h.recipe_id ? recipes.find((r) => r.id === h.recipe_id) : null;
  const [more, setMore] = useState(false);
  return (
    <div className="space-y-3 text-sm">
      {recipe && (
        <Link to={`/recipes/${recipe.id}`} className="flex min-h-[44px] items-center gap-2 rounded-xl bg-brand-soft px-3 text-brand">
          <Icon name="meals" size={18} /><span className="min-w-0 flex-1 truncate font-bold">{t('وصفة: {name}', { name: tMaybe(recipe.name) })}</span><span>{isEn() ? '›' : '‹'}</span>
        </Link>
      )}
      <div className="flex items-baseline gap-2">
        <EntryGlance h={h} />
        <span className="ms-auto text-slate-500">{fmtTime(new Date(h.eaten_at))}</span>
      </div>
      {h.photo_path && <a href={photoUrl(h.photo_path)!} target="_blank" rel="noreferrer"><img src={photoUrl(h.photo_path)!} alt={t('صورة الأكل')} className="max-h-56 w-full rounded-xl object-cover" /></a>}
      {h.needs_review && <Link to="/import" className="block rounded-xl bg-near-soft p-2.5 text-sm font-medium text-near">{t('ربما سُجّل جزء منها مرتين في Gluroo، فهي مستبعدة من البحث تلقائيًا. لا يلزم شيء منكم.')}</Link>}
      <button onClick={() => setMore(!more)} aria-expanded={more} className="min-h-[44px] text-sm font-bold text-brand">{more ? t('أقل') : t('تفاصيل')}</button>
      {more && <>
      {h.glucose_mgdl !== null && (
        <p className="flex items-center gap-1 text-slate-600">{t('السكر عند التسجيل:')} <b className="num">{formatGlucose(h.glucose_mgdl, unit)}</b> {tMaybe(unitLabel(unit))} {h.glucose_trend ? <Icon name={TREND_ICON[h.glucose_trend]} size={14} label={tMaybe(TREND_WORDS[h.glucose_trend])} /> : null}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {h.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-2 py-1.5"><span><bdi>{l.name}</bdi> · <span className="num">{fmt(l.quantity)}</span> {unitText(l.unit)}{l.state !== 'as_is' ? ` ${stateText(l.state).toLowerCase()}` : ''}</span><span className="num font-medium">{fmt(l.carbs)}</span></li>
        ))}
      </ul>
      {h.lines.length > 0 && <button onClick={onEditItems} className="min-h-[44px] text-sm font-bold text-brand">{t('تعديل الأصناف والكميات')}</button>}
      {h.total_kcal !== null && <p className="num text-xs text-slate-500">{t('دهون {fat}غ • ألياف {fiber}غ • بروتين {protein}غ • {kcal} سعرة', { fat: fmt(h.total_fat), fiber: fmt(h.total_fiber), protein: fmt(h.total_protein), kcal: h.total_kcal })}</p>}
      <p className="text-xs text-slate-500">{t('اختيرت {n} مرة', { n })}{h.modified ? ' · ' + t('معدّلة') : ''}</p>
      <MealPrediction id={h.id} unit={unit} />
      </>}
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
