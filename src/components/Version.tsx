import { useCallback, useEffect, useState } from 'react';
import releases from '../releases.json';
import { Btn, Card } from './ui';
import { isEn, t } from '../i18n';

/** "الإصدار 0.2.0" — tapping it shows what changed. */
export function VersionTag() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="text-xs text-slate-400 underline">{t('الإصدار')} <span className="num mx-1">{__APP_VERSION__}</span> {t('· ما الجديد')}</button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 sm:place-items-center" onClick={() => setOpen(false)}>
          <Card className="max-h-[80vh] w-full max-w-lg overflow-y-auto !rounded-b-none sm:!rounded-2xl">
            <h2 className="mb-3 text-xl font-bold">{t('ما الجديد')}</h2>
            {releases.map((r) => (
              <div key={r.version} className="mb-4">
                <div className="mb-1 font-bold">{t('الإصدار')} <span className="num">{r.version}</span> <span className="num text-sm font-normal text-slate-400">{r.date}</span></div>
                <ul className="list-disc space-y-1 ps-5 text-sm text-slate-700">{((isEn() && (r as { notes_en?: string[] }).notes_en) || r.notes).map((n) => <li key={n}>{n}</li>)}</ul>
              </div>
            ))}
            <Btn block onClick={() => setOpen(false)}>{t('إغلاق')}</Btn>
          </Card>
        </div>
      )}
    </>
  );
}

/** Checks for a newer build when the app is opened or brought back, and offers a reload. */
export function UpdateBanner() {
  const [next, setNext] = useState<string | null>(null);
  const check = useCallback(async () => {
    try {
      const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return;
      const v = (await r.json()) as { version: string; build: string };
      if (v.build && v.build !== __BUILD_ID__) setNext(v.version);
    } catch { /* offline: try again next time */ }
  }, []);
  useEffect(() => {
    void check();
    const vis = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', vis);
    const t = window.setInterval(check, 5 * 60_000);
    return () => { document.removeEventListener('visibilitychange', vis); window.clearInterval(t); };
  }, [check]);
  if (!next) return null;
  return (
    <button onClick={() => location.reload()}
      className="fixed inset-x-3 top-3 z-50 mx-auto block max-w-md rounded-2xl bg-brand px-4 py-3 text-center font-medium text-white shadow-lg">
      {t('يوجد تحديث جديد ({v}) — اضغط للتحديث', { v: next })}
    </button>
  );
}
