// Recently deleted: meals and entries deleted in the last 30 days, each with who deleted it and when, and one button
// to bring it back exactly as it was. Nothing is ever removed for good from here.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/data';
import { restoreEvent, restoreHistory } from '../lib/api';
import { describeEvent } from '../lib/events';
import { fmt } from '../lib/carbs';
import { fmtTime } from '../lib/constants';
import { sinceText } from '../lib/now';
import { dayTitle, dayStartOf } from '../engine/day';
import type { EventRow, HistoryEntry } from '../lib/types';
import { Btn, Card, Page, toast } from '../components/ui';
import { MomPage } from './mom/MomUI';
import { t, tMaybe } from '../i18n';

type Row = { id: string; meal: boolean; title: string; at: string; deletedAt: string; by: string | null };
const when = (iso: string) => `${dayTitle(dayStartOf(Date.parse(iso)))} · ${fmtTime(new Date(iso))}`;

function useDeleted() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [h, e] = await Promise.all([
      supabase.from('meal_history').select('*').gte('deleted_at', since).order('deleted_at', { ascending: false }).limit(50),
      supabase.from('events').select('*').gte('deleted_at', since).order('deleted_at', { ascending: false }).limit(50),
    ]);
    if (h.error || e.error) { toast((h.error ?? e.error)!.message); setRows([]); return; }
    const meals: Row[] = (h.data as HistoryEntry[]).map((x) => ({ id: x.id, meal: true, title: `${tMaybe(x.name)} · ${x.carbs_unknown ? t('الكارب غير معروف') : `${fmt(Number(x.total_carbs))} ${t('غ كارب')}`}`, at: x.eaten_at, deletedAt: x.deleted_at!, by: x.deleted_by ?? null }));
    const evs: Row[] = (e.data as EventRow[]).map((x) => ({ id: x.id, meal: false, title: describeEvent({ ...x, insulin_units: x.insulin_units === null ? null : Number(x.insulin_units), carbs_g: x.carbs_g === null ? null : Number(x.carbs_g) }), at: x.occurred_at, deletedAt: x.deleted_at!, by: x.deleted_by ?? null }));
    setRows([...meals, ...evs].sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt)));
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { rows, load };
}

function DeletedList({ big }: { big?: boolean }) {
  const { nameOf, reload } = useData();
  const { rows, load } = useDeleted();
  const [busy, setBusy] = useState('');
  const bring = async (r: Row) => {
    setBusy(r.id);
    try { await (r.meal ? restoreHistory(r.id) : restoreEvent(r.id)); await Promise.all([reload(), load()]); toast(t('رجعت ✓')); }
    catch (x) { toast((x as Error).message); } finally { setBusy(''); }
  };
  if (rows === null) return <p className="text-center text-slate-500">…</p>;
  if (!rows.length) return <Card><p className="text-slate-500">{t('ما في شي محذوف في آخر 30 يوم.')}</p></Card>;
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className={big ? 'block text-[18px] font-bold' : 'block font-semibold'}><bdi>{r.title}</bdi></span>
            <span className="block text-[14px] text-slate-500">{when(r.at)}</span>
            <span className="block text-[13px] text-slate-400">{t('انحذفت {when}', { when: sinceText(r.deletedAt) })}{r.by ? <> · <bdi>{nameOf(r.by)}</bdi></> : null}</span>
          </span>
          <Btn kind="soft" className={big ? 'min-h-[52px] shrink-0 px-4 text-[17px]' : 'min-h-[44px] shrink-0'} disabled={!!busy} onClick={() => void bring(r)}>↩︎ {t('إرجاع')}</Btn>
        </li>
      ))}
    </ul>
  );
}

export function DeletedPage() {
  const nav = useNavigate();
  return <Page title={t('المحذوفة مؤخرًا')} back={() => nav(-1)}><DeletedList /></Page>;
}
export function MomDeleted() {
  return <MomPage title={t('المحذوفة مؤخرًا')} back="/mom/more"><DeletedList big /></MomPage>;
}
