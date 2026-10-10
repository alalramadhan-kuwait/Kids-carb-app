import { carbsOrUnknown } from '../lib/unknownMeal';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { SameMealLink, useSameMeal } from './SameMeal';
import { useData } from '../lib/data';
import { canLogAgain, mealSlot, similar } from '../lib/entryActions';
import { eventAgain, mealAgain } from '../lib/entrySave';
import { deleteEvent, deleteHistory } from '../lib/api';
import { describeEvent } from '../lib/events';
import { fmt } from '../lib/carbs';
import { fmtTime } from '../lib/constants';
import { formatGlucose } from '../lib/glucose';
import type { EventRow, HistoryEntry } from '../lib/types';
import { Icon } from './Icon';
import type { IconName } from '../icons/defs';
import { Btn, cx, toast } from './ui';
import { locale, t, tMaybe, tr } from '../i18n';

const SLOT: Record<string, string> = tr({ breakfast: 'فطور', lunch: 'غداء', dinner: 'عشاء', late: 'ليلي' }); // i18n-ok: values translated when read
const day = (iso: string) => new Date(iso).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);

/**
 * What can be done with a logged entry: Edit first (time, note and every value are in it); then log again, a new
 * meal from this one, copy; Delete on its own at the bottom. For a meal also its kind (breakfast, lunch…), who
 * changed it last, and the earlier times she had it.
 */
export function EntryActions({ e, h, onEdit, onRemove, onOpenOther, onClose }: {
  e?: EventRow; h?: HistoryEntry; onEdit: () => void; onRemove: () => void; onOpenOther: (h: HistoryEntry) => void; onClose: () => void;
}) {
  const { me, reload, history, nameOf, settings } = useData();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const kind = h ? 'meal' : e!.kind;
  const at = Date.parse(h ? h.eaten_at : e!.occurred_at);
  const edited = (h ?? e)?.edited_at;
  const before = h ? similar(h, history) : [];
  const same = useSameMeal(h?.id);
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (x) { toast((x as Error).message); } finally { setBusy(false); } };

  const again = () => run(async () => {
    const id = h ? await mealAgain(h) : await eventAgain(e!);
    await reload(); onClose();
    toast(t('سُجّل مرة ثانية الآن: {x}', { x: h ? `${tMaybe(h.name)} · ${carbsOrUnknown(h.total_carbs)}` : describeEvent(e!) }),
      { label: t('تراجع'), run: async () => { if (h) await deleteHistory(id); else await deleteEvent(id, me); await reload(); } });
  });
  const copy = async () => {
    const text = h ? `${h.name}${h.brand ? ` (${h.brand})` : ''} · ${carbsOrUnknown(h.total_carbs)} · ${fmtTime(new Date(at))}` : `${describeEvent(e!)} · ${fmtTime(new Date(at))}`;
    try { await navigator.clipboard.writeText(text); toast(t('نُسخ ✓')); } catch { toast(text); }
  };

  // one main action (Edit holds the time, the note and every value), three small ones, and Delete on its own
  const more: { icon: IconName; label: string; on: () => void; show: boolean }[] = [
    { icon: 'repeat', label: t('سجّل مرة ثانية'), on: again, show: canLogAgain(kind) },
    { icon: 'meals', label: t('وجبة جديدة منها'), on: () => { onClose(); nav(`/reuse/${h!.id}`); }, show: !!h && h.lines.length > 0 },
    { icon: 'copy', label: t('نسخ'), on: copy, show: true },
  ];
  const shown = more.filter((x) => x.show);

  return (
    <div className="mt-3 space-y-3">
      {(h || edited) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {h && <span className="rounded-full bg-near-soft px-2.5 py-1 font-medium text-near">{h.meal_slot ? (h.meal_slot === 'snack' ? t('سناك') : SLOT[h.meal_slot]) : h.kind === 'snack' ? t('سناك') : SLOT[mealSlot(at)]}</span>}
          {h?.brand && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600"><bdi>{h.brand}</bdi></span>}
          {edited && <span className="text-slate-500">{t('عُدّل {when} · {who}', { when: `${day(edited)} ${fmtTime(new Date(edited))}`, who: nameOf((h ?? e)!.edited_by ?? null) })}</span>}
        </div>
      )}

      <Btn kind="primary" block className="flex min-h-[52px] items-center justify-center gap-2 text-base" disabled={busy} onClick={onEdit}><Icon name="edit" size={20} />{t('تعديل')}</Btn>
      <div className={cx('grid gap-2', shown.length === 3 ? 'grid-cols-3' : shown.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
        {shown.map((x) => (
          <button key={x.label} disabled={busy} onClick={x.on} className="flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-2xl bg-slate-50 px-1 text-[13px] font-medium leading-tight text-slate-700 active:bg-slate-100">
            <Icon name={x.icon} size={18} /><span className="max-w-full text-center">{x.label}</span>
          </button>
        ))}
      </div>

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
      {/* set apart from everything else; kept and recoverable (Undo, or More › Recently deleted) */}
      <div className="border-t border-slate-100 pt-2">
        <button disabled={busy} onClick={onRemove} className="flex min-h-[44px] items-center gap-2 text-sm font-bold text-over"><Icon name="trash" size={18} /> {t('حذف')}</button>
        <p className="text-[11px] text-slate-500">{t('يمكن إرجاعه: «تراجع» بعد الحذف، أو المزيد › المحذوفة مؤخرًا.')}</p>
      </div>
    </div>
  );
}
