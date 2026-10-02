import { t } from '../i18n';

/** What the dashed lines are, in one quiet row under the graph. */
export function ForecastKey({ past }: { past?: boolean }) {
  const Dash = ({ d, faint }: { d: string; faint?: boolean }) => (
    <svg width="22" height="6" aria-hidden><line x1="1" y1="3" x2="21" y2="3" strokeWidth="2" strokeDasharray={d} strokeLinecap="round" className={faint ? 'stroke-slate-400' : 'stroke-brand'} /></svg>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-1 text-[11px] text-slate-500">
      <span className="flex items-center gap-1"><Dash d="6 4" />{t('التقدير مع ما في الجسم')}</span>
      <span className="flex items-center gap-1"><Dash d="2 4" />{t('الاتجاه 30 د')}</span>
      {past && <span className="flex items-center gap-1"><Dash d="4 4" faint />{t('توقع الوجبات السابقة')}</span>}
      <span>{t('للعرض فقط، ليس للجرعة')}</span>
    </div>
  );
}
