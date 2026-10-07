// Simple mode: a blood test (finger-prick). One number and one button: the number is saved as a finger-prick, and the
// app compares it with the sensor, the same as in the full app. Nothing about a dose is changed by it.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../lib/data';
import { saveEvent } from '../../lib/api';
import { startComparison } from '../../lib/fingerprick';
import { effectiveRange, formatGlucose, toMgdl, unitLabel } from '../../lib/glucose';
import { inputCls, toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import { Big, MomPage } from './MomUI';

export function MomPrick() {
  const nav = useNavigate();
  const { settings, reload } = useData();
  const unit = settings.glucose_unit;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const v = Number(text.replace(',', '.'));
  const mg = Number.isFinite(v) && text.trim() !== '' ? toMgdl(v, unit) : null;
  const ok = mg !== null && mg >= 20 && mg <= 600;
  const low = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl).low ?? 70;
  const save = async () => {
    if (!ok || mg === null) return;
    setBusy(true);
    try {
      const at = new Date().toISOString();
      const id = await saveEvent({ client_id: crypto.randomUUID(), kind: 'bg_check', occurred_at: at, bg_mgdl: mg, insulin_units: null, insulin_type: null, bolus_purpose: null,
        carbs_g: null, treatment: null, note: null, activity_min: null, activity_level: null, ends_at: null, dose_calc: null });
      if (id) await startComparison(id, Date.parse(at), mg, 0, true);
      await reload();
      toast(t('تم: {v}', { v: `${formatGlucose(mg, unit)}` }));
      nav(mg < low ? '/mom/juice' : '/mom', { replace: true });
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };
  return (
    <MomPage title={t('فحص بالإصبع')} back="/mom" foot={<Big disabled={!ok || busy} onClick={save}>✓ {mg !== null && mg < low ? t('احفظي · وعطيها عصير') : t('احفظي')}</Big>}>
      <div className="rounded-3xl bg-white p-6 text-center">
        <div className="mb-2 text-[17px] text-slate-500">🩸 {t('كم طلع؟')} · {tMaybe(unitLabel(unit))}</div>
        <input autoFocus inputMode="decimal" dir="ltr" value={text} onChange={(e) => setText(e.target.value)}
          className={`${inputCls} !min-h-[80px] !text-center !text-[48px] font-extrabold`} placeholder={unit === 'mmol' ? '5.6' : '100'} />
      </div>
      {mg !== null && !ok && <p className="text-center text-[17px] font-bold text-over">{t('الرقم غريب، راجعيه')}</p>}
      {mg !== null && ok && mg < low && <p className="rounded-2xl bg-over-soft px-4 py-3 text-center text-[18px] font-bold text-over">🧃 {t('أقل من الطبيعي: عطيها عصير')}</p>}
      <p className="text-center text-[15px] text-slate-500">{t('للمقارنة مع الحساس فقط: ما يغيّر الجرعة.')}</p>
    </MomPage>
  );
}
