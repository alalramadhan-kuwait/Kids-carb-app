// Full mode: where this dose goes. The rotation's next site is chosen; tap to see her body map (when each site was
// last used, the sensor's site locked) and pick another.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { allowedSites, useSiteRotation, type SiteRotation } from '../lib/sites';
import { useData } from '../lib/data';
import { setInjectionSite } from '../lib/api';
import { toast } from './ui';
import type { EventRow, InjectionSite } from '../lib/types';
import { BodyMap, SITE_NAME, ago } from '../pages/mom/MomUI';
import { t } from '../i18n';

export function SitePicker({ rot, value, onChange }: { rot: SiteRotation; value: InjectionSite | null; onChange: (s: InjectionSite) => void }) {
  const [open, setOpen] = useState(false);
  const pick = value ?? rot.suggest;
  const last = pick ? rot.last.get(pick) : undefined;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-[48px] w-full items-center justify-between gap-2 text-start">
        <span className="min-w-0">
          <span className="block text-sm text-slate-500">{t('مكان الإبرة')}</span>
          <b className="text-[17px]">{pick ? t(SITE_NAME[pick]) : '—'}</b>
          {pick && pick === rot.suggest && <span className="ms-2 text-sm font-semibold text-ok">⭐ {t('الأنسب الآن')}</span>}
          {pick && <span className="block text-xs text-slate-500">{last === undefined ? t('لم يُستخدم بعد') : t('آخر إبرة فيه: {w}', { w: ago(last) })}</span>}
        </span>
        <span className="shrink-0 text-sm font-bold text-brand">{open ? t('تم') : t('تغيير')}</span>
      </button>
      {open && (
        <div className="space-y-2 pb-1 pt-2">
          <BodyMap allowed={rot.allowed} last={rot.last} suggest={rot.suggest} sel={pick} onPick={onChange} now={Date.now()} sensor={rot.sensor} />
          {rot.sensor && <p className="text-center text-sm text-slate-500">📡 {t('الحساس: {s} · لا إبرة فيه', { s: t(SITE_NAME[rot.sensor]) })}</p>}
          <Link to="/sites" className="block min-h-[44px] py-2 text-center text-sm font-bold text-brand">{t('سجل أماكن الإبر')}</Link>
        </div>
      )}
    </div>
  );
}

/** A logged dose's site in the Log: shown, and set or changed on her map (any allowed site: the sensor may have been
 *  elsewhere then). */
export function DoseSite({ e }: { e: EventRow }) {
  const { settings, reload } = useData();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const type = e.insulin_type === 'long' ? 'long' : 'rapid';
  const r = useSiteRotation(type, e.id);
  const pick = async (s: InjectionSite) => {
    setBusy(true);
    try { await setInjectionSite(e.id, s); await reload(); toast(t('تم حفظ المكان ✓')); setOpen(false); }
    catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-1">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-[44px] w-full items-center justify-between gap-2 text-start">
        <span>💉 {t('مكان الإبرة')}: <b className={e.injection_site ? 'text-slate-800' : 'text-slate-400'}>{e.injection_site ? t(SITE_NAME[e.injection_site]) : t('بلا مكان')}</b></span>
        <span className="text-sm font-bold text-brand">{open ? t('تم') : e.injection_site ? t('تغيير') : t('حدّد')}</span>
      </button>
      {open && (
        <div className={busy ? 'pointer-events-none pb-2 opacity-60' : 'pb-2'}>
          <BodyMap allowed={allowedSites(settings, type)} last={r.last} suggest={null} sel={e.injection_site ?? null} onPick={(s) => void pick(s)} now={Date.now()} />
          <p className="text-center text-xs text-slate-500">{t('اضغط المكان الذي أُعطيت فيه')}</p>
        </div>
      )}
    </div>
  );
}
