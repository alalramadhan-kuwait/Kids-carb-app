import { useMemo, useState } from 'react';
import { useData } from '../lib/data';
import { fmt, stateText, unitText } from '../lib/carbs';
import { deleteEvent, deleteHistory, restoreEvent } from '../lib/api';
import { EVENT_ICON, describeEvent } from '../lib/events';
import type { EventRow, HistoryEntry } from '../lib/types';
import type { IconName } from '../icons/defs';
import { formatGlucose, unitLabel } from '../lib/glucose';
import { Icon, TREND_ICON, TREND_WORDS } from '../components/Icon';
import { dayName, fmtDate, fmtTime } from '../lib/constants';
import { Badge, Btn, Card, Chip, Page, toast } from '../components/ui';
import { t, tMaybe } from '../i18n';

// Filter values: 'سناك' is the category stored on logged snacks; LOGS is the chip for parent entries (shown via tMaybe).
const SNACK = 'سناك'; // i18n-ok
const LOGS = 'التسجيلات'; // i18n-ok

export default function History() {
  const { history, events, reload, settings, nameOf, me } = useData();
  const [range, setRange] = useState<7 | 30 | 0>(7);
  const [cat, setCat] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const keyOf = (h: { recipe_id: string | null; name: string }) => h.recipe_id ?? `n:${h.name}`;
  const times = useMemo(() => { const m = new Map<string, number>(); for (const h of history) m.set(keyOf(h), (m.get(keyOf(h)) ?? 0) + 1); return m; }, [history]);

  const since = range ? Date.now() - range * 86400000 : 0;
  const rows = history.filter((h) => new Date(h.eaten_at).getTime() >= since && (!cat || (cat === SNACK ? h.kind === 'snack' : h.category === cat)));
  const evRows = events.filter((e) => new Date(e.occurred_at).getTime() >= since && (!cat || cat === LOGS));
  const mealRows = cat === LOGS ? [] : rows;
  const items: { t: string; h?: HistoryEntry; e?: EventRow }[] = [
    ...mealRows.map((h) => ({ t: h.eaten_at, h })), ...evRows.map((e) => ({ t: e.occurred_at, e })),
  ].sort((a, b) => b.t.localeCompare(a.t));
  const cats = [LOGS, ...new Set(history.map((h) => (h.kind === 'snack' ? SNACK : h.category)).filter(Boolean))] as string[];
  const removeEvent = async (e: EventRow) => {
    await deleteEvent(e.id, me); await reload();
    toast(t('حُذف التسجيل'), { label: t('تراجع'), run: async () => { await restoreEvent(e.id); await reload(); } });
  };

  const top = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const h of rows.filter((x) => x.kind === 'meal')) { const c = m.get(keyOf(h)) ?? { name: h.name, n: 0 }; c.n++; m.set(keyOf(h), c); }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  }, [rows]);

  return (
    <Page title={t('السجل')}>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        <Chip active={range === 7} onClick={() => setRange(7)}>{t('آخر 7 أيام')}</Chip>
        <Chip active={range === 30} onClick={() => setRange(30)}>{t('آخر 30 يوم')}</Chip>
        <Chip active={range === 0} onClick={() => setRange(0)}>{t('الكل')}</Chip>
      </div>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        <Chip active={!cat} onClick={() => setCat('')}>{t('كل الأنواع')}</Chip>
        {cats.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{tMaybe(c)}</Chip>)}
      </div>

      {top.length > 0 && (
        <Card className="mb-4">
          <h2 className="mb-2 font-bold">{t('أكثر الوجبات استخدامًا')}</h2>
          <ol className="space-y-1">{top.map((t, i) => <li key={t.name} className="flex justify-between"><span>{i + 1}. {t.name}</span><span className="num font-bold">×{t.n}</span></li>)}</ol>
        </Card>
      )}

      <div className="space-y-3">
        {items.map((it) => {
          if (it.e) return <EventItem key={it.e.id} e={it.e} who={nameOf(it.e.created_by)} onDelete={() => removeEvent(it.e!)} />;
          const h = it.h!;
          const d = new Date(h.eaten_at);
          return (
            <Card key={h.id} className="!p-3">
              <button className="flex w-full items-center gap-3 text-start" onClick={() => setOpen(open === h.id ? null : h.id)}>
                <div className="w-20 shrink-0 text-center text-sm text-slate-500"><div className="font-bold text-slate-700">{dayName(d)}</div><div className="num">{fmtDate(d)}</div></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{h.name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-slate-500"><span>{fmtTime(d)}</span>
                    {h.kind === 'snack' && <Badge>{t('سناك')}</Badge>}{h.modified && <Badge tone="near">{t('معدّلة')}</Badge>}{h.glucose_mgdl !== null && <Badge tone="brand"><span className="inline-flex items-center gap-1"><Icon name="glucose" size={12} /><span className="num">{formatGlucose(h.glucose_mgdl, settings.glucose_unit)}</span>{h.glucose_trend ? <Icon name={TREND_ICON[h.glucose_trend]} size={12} label={tMaybe(TREND_WORDS[h.glucose_trend])} /> : null}</span></Badge>}<span>{t('اختيرت {n} مرة', { n: times.get(keyOf(h)) })}</span></div>
                </div>
                <div className="num text-2xl font-bold text-brand">{fmt(h.total_carbs)}<span className="text-xs font-medium"> {t('غ')}</span></div>
              </button>
              {open === h.id && (
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
                  {h.glucose_mgdl !== null && <div className="text-slate-600">{t('السكر عند التسجيل:')} <b className="num">{formatGlucose(h.glucose_mgdl, settings.glucose_unit)}</b> {tMaybe(unitLabel(settings.glucose_unit))} {h.glucose_trend ? tMaybe(TREND_WORDS[h.glucose_trend]) : ''}</div>}
                  {h.total_kcal !== null && <div className="num text-slate-600">{t('دهون {fat}غ • ألياف {fiber}غ • بروتين {protein}غ • {kcal} سعرة', { fat: fmt(h.total_fat), fiber: fmt(h.total_fiber), protein: fmt(h.total_protein), kcal: h.total_kcal })}</div>}
                  <ul className="space-y-1">
                    {h.lines.map((l, i) => (
                      <li key={i} className="flex justify-between gap-2"><span>{l.name}{l.product && l.product !== l.name ? ` (${l.product})` : ''} — <span className="num">{fmt(l.quantity)}</span> {unitText(l.unit)}{l.state !== 'as_is' ? ` ${stateText(l.state).toLowerCase()}` : ''}</span><span className="num font-medium">{fmt(l.carbs)}</span></li>
                    ))}
                  </ul>
                  <Btn kind="danger" onClick={async () => { if (confirm(t('حذف هذا التسجيل من السجل؟'))) { await deleteHistory(h.id); await reload(); toast(t('تم الحذف')); } }}>{t('حذف التسجيل')}</Btn>
                </div>
              )}
            </Card>
          );
        })}
        {items.length === 0 && <Card><p className="text-slate-500">{t('لا يوجد شيء في هذه الفترة.')}</p></Card>}
      </div>
    </Page>
  );
}


function EventItem({ e, who, onDelete }: { e: EventRow; who: string; onDelete: () => void }) {
  const d = new Date(e.occurred_at);
  return (
    <Card className="flex items-center gap-3 !p-3">
      <div className="w-16 shrink-0 text-center text-sm text-slate-500"><div className="font-bold text-slate-700">{dayName(d)}</div><div className="num">{fmtTime(d)}</div></div>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name={EVENT_ICON[e.kind]} size={20} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{e.kind === 'note' ? t('ملاحظة') : describeEvent(e)}</div>
        <div className="truncate text-xs text-slate-500">{[e.kind === 'note' ? e.note : e.note, who].filter(Boolean).join(' · ')}</div>
      </div>
      <button aria-label={t('حذف')} className="min-h-[44px] shrink-0 px-2 text-sm text-over" onClick={onDelete}>{t('حذف')}</button>
    </Card>
  );
}
