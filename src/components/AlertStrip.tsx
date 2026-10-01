import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { ackAlert } from '../lib/push';
import { formatGlucose } from '../lib/glucose';
import { sinceText } from '../lib/now';
import type { AlertKind, AlertRow } from '../lib/types';
import { Btn, cx, toast } from './ui';

export const ALERT_NAME: Record<AlertKind, string> = { urgent_low: 'منخفض جدًا', low: 'منخفض', high: 'مرتفع', no_data: 'لا توجد قراءة' };
const STYLE: Record<AlertKind, string> = {
  urgent_low: 'bg-over text-white', low: 'bg-over-soft text-over', high: 'bg-near-soft text-near', no_data: 'bg-slate-100 text-slate-700',
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('ar-KW-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuwait' });

/** Active alerts above the graph: what, since when, who is on it. Compact, never a full-screen banner. */
export function AlertStrip({ alerts, onChange }: { alerts: AlertRow[]; onChange: () => void }) {
  const { settings, nameOf } = useData();
  const [busy, setBusy] = useState('');
  if (!alerts.length) return null;
  const act = async (a: AlertRow, ack: 'on_it' | 'treated') => {
    setBusy(a.id);
    try { const r = await ackAlert(a.id, ack); if (r.error) toast('انتهى التنبيه'); onChange(); }
    catch (e) { toast('تعذّر: ' + (e as Error).message); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-2" role="alert">
      {alerts.map((a) => (
        <div key={a.id} className={cx('rounded-2xl p-3', STYLE[a.kind])}>
          <div className="flex items-baseline gap-2">
            <b className="text-lg">{ALERT_NAME[a.kind]}</b>
            {a.value_mgdl !== null && a.kind !== 'no_data' && <b className="num text-lg">{formatGlucose(a.value_mgdl, settings.glucose_unit)}</b>}
            <span className="ms-auto text-sm opacity-80">{sinceText(a.active_at ?? a.started_at)}</span>
          </div>
          {a.state === 'acknowledged' && a.acknowledged_by ? (
            <div className="mt-1 text-sm">✓ <b>{nameOf(a.acknowledged_by)}</b> {a.ack_action === 'treated' ? 'عالجها' : 'عليها'}{a.snoozed_until ? ` · حتى ${clock(a.snoozed_until)}` : ''}</div>
          ) : null}
          <div className="mt-2 grid grid-cols-3 gap-2">
            {a.state === 'active'
              ? <Btn kind="primary" className="col-span-2 min-h-[48px]" disabled={busy === a.id} onClick={() => act(a, 'on_it')}>أنا عليها</Btn>
              : <Btn className="col-span-2 min-h-[48px]" disabled={busy === a.id} onClick={() => act(a, 'treated')}>{a.kind === 'no_data' ? 'تمّ التحقق' : 'عالجتها'}</Btn>}
            <Link to="/care-plan" className="flex min-h-[48px] items-center justify-center rounded-xl bg-white/80 text-sm font-bold text-slate-800">خطة الطبيب</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
