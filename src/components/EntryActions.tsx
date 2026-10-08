import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { SameMealLink, useSameMeal } from './SameMeal';
import { useData } from '../lib/data';
import { canLogAgain, mealSlot, similar } from '../lib/entryActions';
import { eventAgain, mealAgain, setEntryNote, setEntryTime } from '../lib/entrySave';
import { deleteEvent, deleteHistory } from '../lib/api';
import { describeEvent } from '../lib/events';
import { fmt } from '../lib/carbs';
import { fmtTime } from '../lib/constants';
import { formatGlucose } from '../lib/glucose';
import type { EventRow, HistoryEntry } from '../lib/types';
import { Icon } from './Icon';
import { TimePicker } from './TimePicker';
import type { IconName } from '../icons/defs';
import { Btn, cx, inputCls, toast } from './ui';
import { locale, t, tMaybe, tr } from '../i18n';

const SLOT: Record<string, string> = tr({ breakfast: 'فطور', lunch: 'غداء', dinner: 'عشاء', late: 'ليلي' }); // i18n-ok: values translated when read
const day = (iso: string) => new Date(iso).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);

/**
 * What can be done with a logged entry, in one tap each (as in Gluroo): edit, note, time, log again, copy, delete;
 * for a meal also when it was eaten (breakfast, lunch…), who changed it last, and the earlier times she had it.
 */
export function EntryActions({ e, h, onEdit, onRemove, onOpenOther, onClose }: {
  e?: EventRow; h?: HistoryEntry; onEdit: () => void; onRemove: () => void; onOpenOther: (h: HistoryEntry) => void; onClose: () => void;
}) {
  const { me, reload, history, nameOf, settings } = useData();
  const nav = useNavigate();
  const [panel, setPanel] = useState<'note' | 'time' | null>(null);
  const [note, setNote] = useState((h ? h.notes : e?.note) ?? '');
  const [busy, setBusy] = useState(false);
  const kind = h ? 'meal' : e!.kind;
  const at = Date.parse(h ? h.eaten_at : e!.occurred_at);
  const [pick, setPick] = useState(at);
  const edited = (h ?? e)?.edited_at;
  const before = h ? similar(h, history) : [];
  const same = useSameMeal(h?.id);
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (x) { toast((x as Error).message); } finally { setBusy(false); } };

  const again = () => run(async () => {
    const id = h ? await mealAgain(h) : await eventAgain(e!);
    await reload(); onClose();
    toast(t('سُجّل مرة ثانية الآن: {x}', { x: h ? `${tMaybe(h.name)} · ${t('{g} غ', { g: fmt(h.total_carbs) })}` : describeEvent(e!) }),
      { label: t('تراجع'), run: async () => { if (h) await deleteHistory(id); else await deleteEvent(id, me); await reload(); } });
  });
  const moveTo = (ms: number) => run(async () => {
    await setEntryTime({ e, h }, ms, me); await reload(); setPanel(null);
    toast(t('صار الوقت {t}', { t: fmtTime(new Date(ms)) }), { label: t('تراجع'), run: async () => { await setEntryTime({ e, h }, at, me); await reload(); } });
  });
  const saveNote = () => run(async () => { await setEntryNote({ e, h }, note, me); await reload(); setPanel(null); toast(t('تم الحفظ ✓')); });
  const copy = async () => {
    const text = h ? `${h.name}${h.brand ? ` (${h.brand})` : ''} · ${t('{g} غ كارب', { g: fmt(h.total_carbs) })} · ${fmtTime(new Date(at))}` : `${describeEvent(e!)} · ${fmtTime(new Date(at))}`;
    try { await navigator.clipboard.writeText(text); toast(t('نُسخ ✓')); } catch { toast(text); }
  };

  const tiles: { icon: IconName; label: string; on: () => void; show: boolean; tone?: string }[] = [
    { icon: 'edit', label: t('تعديل'), on: onEdit, show: true },
    { icon: 'note', label: t('ملاحظة'), on: () => setPanel(panel === 'note' ? null : 'note'), show: true },
    { icon: 'clock', label: t('الوقت'), on: () => setPanel(panel === 'time' ? null : 'time'), show: true },
    { icon: 'repeat', label: t('سجّل مرة ثانية'), on: again, show: canLogAgain(kind) },
    { icon: 'edit', label: t('عدّليها لوجبة جديدة'), on: () => { onClose(); nav(`/reuse/${h!.id}`); }, show: !!h && h.lines.length > 0 },
    { icon: 'copy', label: t('نسخ'), on: copy, show: true },
    { icon: 'trash', label: t('حذف'), on: onRemove, show: true, tone: 'text-over' },
  ];

  return (
    <div className="mt-3 space-y-3">
      {(h || edited) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {h && <span className="rounded-full bg-near-soft px-2.5 py-1 font-medium text-near">{h.kind === 'snack' ? t('سناك') : SLOT[mealSlot(at)]}</span>}
          {h?.brand && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600"><bdi>{h.brand}</bdi></span>}
          {edited && <span className="text-slate-500">{t('عُدّل {when} · {who}', { when: `${day(edited)} ${fmtTime(new Date(edited))}`, who: nameOf((h ?? e)!.edited_by ?? null) })}</span>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {tiles.filter((x) => x.show).map((x) => (
          <button key={x.label} disabled={busy} onClick={x.on} className={cx('flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl bg-slate-50 text-sm font-medium active:bg-slate-100', x.tone ?? 'text-slate-700', (x.label === t('ملاحظة') && panel === 'note') || (x.label === t('الوقت') && panel === 'time') ? 'ring-2 ring-brand' : '')}>
            <Icon name={x.icon} size={20} />{x.label}
          </button>
        ))}
      </div>

      {panel === 'note' && (
        <div className="flex gap-2">
          <input className={inputCls} dir="auto" value={note} maxLength={300} autoFocus placeholder={t('اكتبوا ملاحظة')} onChange={(x) => setNote(x.target.value)} onKeyDown={(x) => x.key === 'Enter' && saveNote()} />
          <Btn kind="primary" disabled={busy} onClick={saveNote}>{t('حفظ')}</Btn>
        </div>
      )}
      {panel === 'time' && (
        <div className="space-y-2 rounded-2xl border border-slate-100 p-3">
          <TimePicker value={pick} onChange={setPick} />
          <div className="grid grid-cols-2 gap-2">
            <Btn kind="ghost" onClick={() => { setPick(at); setPanel(null); }}>{t('إلغاء')}</Btn>
            <Btn kind="primary" disabled={busy || pick === at} onClick={() => moveTo(pick)}>{t('حفظ')}</Btn>
          </div>
        </div>
      )}

      {same && same.matches.length > 0 && <SameMealLink to={`/same/${same.target.id}`} target={same.target} matches={same.matches} />}
      {before.length > 0 && (
        <div>
          <div className="mb-1 text-sm font-bold">{t('مرات سابقة')}</div>
          <ul className="divide-y divide-slate-100 rounded-2xl bg-slate-50">
            {before.map((x) => (
              <li key={x.id}><button onClick={() => onOpenOther(x)} className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 text-sm">
                <span>{day(x.eaten_at)} · <span className="num">{fmtTime(new Date(x.eaten_at))}</span></span>
                <span className="text-slate-500">{x.glucose_mgdl !== null && <><span className="num">{formatGlucose(x.glucose_mgdl, settings.glucose_unit)}</span> · </>}<b className="num text-slate-800">{fmt(x.total_carbs)}</b> {t('غ')}</span>
              </button></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
