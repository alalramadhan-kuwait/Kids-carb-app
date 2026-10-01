import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { ackAlert } from '../lib/push';
import { formatGlucose } from '../lib/glucose';
import { sinceText } from '../lib/now';
import type { AlertKind, AlertRow } from '../lib/types';
import { Btn, cx, toast } from './ui';
import { locale, t, tr } from '../i18n';

export const ALERT_NAME: Record<AlertKind, string> = tr({ urgent_low: 'منخفض جدًا', low: 'منخفض', high: 'مرتفع', no_data: 'لا توجد قراءة', rapid_fall: 'نزول سريع', rapid_rise: 'صعود سريع' }); // i18n-ok
const STYLE: Record<AlertKind, string> = {
  urgent_low: 'bg-over text-white', low: 'bg-over-soft text-over', high: 'bg-near-soft text-near', no_data: 'bg-slate-100 text-slate-700',
  rapid_fall: 'bg-over-soft text-over', rapid_rise: 'bg-near-soft text-near',
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale() + '-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuwait' });

/** Active alerts above the graph: what, since when, who is on it. Compact, never a full-screen banner. */
export function AlertStrip({ alerts, onChange }: { alerts: AlertRow[]; onChange: () => void }) {
  const { settings, nameOf } = useData();
  const [busy, setBusy] = useState('');
  if (!alerts.length) return null;
  const act = async (a: AlertRow, ack: 'on_it' | 'treated') => {
    setBusy(a.id);
    try { const r = await ackAlert(a.id, ack); if (r.error) toast(t('انتهى التنبيه')); onChange(); }
    catch (e) { toast(t('تعذّر: {e}', { e: (e as Error).message })); } finally { setBusy(''); }
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
            <div className="mt-1 text-sm">✓ <b>{nameOf(a.acknowledged_by)}</b> {a.ack_action === 'treated' ? t('عالجها') : t('عليها')}{a.snoozed_until ? ' · ' + t('حتى {t}', { t: clock(a.snoozed_until) }) : ''}</div>
          ) : null}
          <div className="mt-2 grid grid-cols-3 gap-2">
            {a.state === 'active'
              ? <Btn kind="primary" className="col-span-2 min-h-[48px]" disabled={busy === a.id} onClick={() => act(a, 'on_it')}>{t('أنا عليها')}</Btn>
              : <Btn className="col-span-2 min-h-[48px]" disabled={busy === a.id} onClick={() => act(a, 'treated')}>{a.kind === 'no_data' ? t('تمّ التحقق') : t('عالجتها')}</Btn>}
            <Link to="/care-plan" className="flex min-h-[48px] items-center justify-center rounded-xl bg-white/80 text-sm font-bold text-slate-800">{t('خطة الطبيب')}</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
