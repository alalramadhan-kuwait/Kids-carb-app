// A dose is about to be recorded and another one is already there (the other parent's, or this phone's a moment ago).
// Never merged, never dropped on its own: the dose already recorded is shown, and the parent says which it is.
import { useData } from '../lib/data';
import { fmt } from '../lib/carbs';
import { fmtTime } from '../lib/constants';
import { sinceText } from '../lib/now';
import { Btn, cx } from './ui';
import { t } from '../i18n';

export type ExistingDose = { units: number; at: string; by: string | null; type?: 'rapid' | 'long' | null };

export function SameDose({ dose, onSame, onSeparate, busy, big }: { dose: ExistingDose; onSame: () => void; onSeparate: () => void; busy?: boolean; big?: boolean }) {
  const { nameOf } = useData();
  const who = dose.by ? nameOf(dose.by) : '';
  const pen = dose.type === 'long' ? t('تريسيبا') : t('نوفورابيد');
  return (
    <div role="alertdialog" aria-live="assertive" className={cx('space-y-3 rounded-3xl border-2 border-near/40 bg-near-soft p-4', big && 'text-[18px]')}>
      <div className="font-bold text-near">{t('في إبرة مسجّلة')}</div>
      <div className="rounded-2xl bg-white px-4 py-3">
        <div className={cx('font-bold', big ? 'text-[22px]' : 'text-lg')}><bdi>{pen}</bdi> <span className="num">{fmt(dose.units)}</span> {t('وحدة')}</div>
        <div className="text-slate-600">{who ? <><bdi>{who}</bdi> · </> : null}{fmtTime(new Date(dose.at))} · {sinceText(dose.at)}</div>
      </div>
      <div className="font-bold">{t('هذي نفس الإبرة؟')}</div>
      <div className="grid gap-2">
        <Btn kind="primary" className={cx(big ? 'min-h-[60px] text-[19px]' : 'min-h-[48px]')} disabled={busy} onClick={onSame}>{t('نعم، نفس الإبرة · لا تسجّل')}</Btn>
        <Btn kind="ghost" className={cx(big ? 'min-h-[60px] text-[19px]' : 'min-h-[48px]', 'border border-slate-300')} disabled={busy} onClick={onSeparate}>{t('لا، إبرة ثانية انعطت · سجّلها')}</Btn>
      </div>
    </div>
  );
}
