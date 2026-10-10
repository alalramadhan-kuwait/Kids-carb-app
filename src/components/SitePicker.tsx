// Full mode: where this dose goes. The rotation's next site is chosen; tap to see her body map (when each site was
// last used, the sensor's site locked) and pick another.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SiteRotation } from '../lib/sites';
import type { InjectionSite } from '../lib/types';
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
