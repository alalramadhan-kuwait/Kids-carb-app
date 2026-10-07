import { t } from '../i18n';

/** When the readings behind a graph could not be loaded: say so (with the reason) and let the person try again,
 *  instead of leaving a graph that looks empty. Shown only after a failure; nothing when all is well. */
export function GraphLoadNotice({ error, empty, retry, className = '' }: { error: string | null; empty: boolean; retry: () => void; className?: string }) {
  if (!error) return null;
  return (
    <button onClick={retry} className={`z-10 flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl bg-near-soft px-3 text-start text-sm text-near ${className}`}>
      <span className="min-w-0"><b>{empty ? t('الرسم ما تحمّل') : t('بعض القراءات ما تحمّلت')}</b> <span className="opacity-80" dir="auto">· {error}</span></span>
      <b className="shrink-0">{t('أعيدي المحاولة')}</b>
    </button>
  );
}
