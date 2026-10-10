// Full mode: where her insulin has gone. The next site for each pen, her body map (when each site was last used, the
// sensor's site locked), how often each site was used in the last 14 days, and every dose with its site. A dose saved
// without a site can be given one here; tap a site on the map to see only its doses.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { setInjectionSite } from '../lib/api';
import { backTo } from '../lib/nav';
import { relDay } from '../lib/constants';
import { allowedSites, shotsOf, useSiteRotation } from '../lib/sites';
import { siteCounts } from '../engine/mom';
import type { EventRow, InjectionSite } from '../lib/types';
import { BodyMap, PEN_NAME, PenBar, SITE_NAME, clock } from './mom/MomUI';
import { Page, Sheet, cx, toast } from '../components/ui';
import { t } from '../i18n';

const DAY = 86400000;

export function SitesPage() {
  const nav = useNavigate();
  const { events, settings, reload, nameOf } = useData();
  const [type, setType] = useState<'all' | 'rapid' | 'long'>('all');
  const [focus, setFocus] = useState<InjectionSite | null>(null);
  const [fix, setFix] = useState<EventRow | null>(null);
  const [busy, setBusy] = useState(false);
  const rapid = useSiteRotation('rapid'), long = useSiteRotation('long');
  const now = Date.now();
  const allowed = allowedSites(settings, type === 'all' ? null : type); // the sensor's site too: doses before it went there still count
  const doses = events.filter((e) => e.kind === 'insulin' && !e.deleted_at && now - Date.parse(e.occurred_at) <= 60 * DAY
    && (type === 'all' || (type === 'long') === (e.insulin_type === 'long'))).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const { counts, overused } = siteCounts(shotsOf(doses), now, allowed);
  const max = Math.max(1, ...counts.values());
  const missing = doses.filter((e) => !e.injection_site && now - Date.parse(e.occurred_at) <= 14 * DAY).length;
  const shown = doses.filter((e) => !focus || e.injection_site === focus).slice(0, 40);
  const penOf = (e: EventRow) => (e.insulin_type === 'long' ? 'long' : 'rapid') as 'rapid' | 'long';

  const save = async (e: EventRow, s: InjectionSite) => {
    setBusy(true);
    try { await setInjectionSite(e.id, s); await reload(); toast(t('تم حفظ المكان ✓')); setFix(null); }
    catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <Page title={t('أماكن الإبر')} back={() => backTo(nav, '/more')}>
      <div className="space-y-4">
        {/* the next site for each pen */}
        <div className="grid grid-cols-2 gap-2">
          {([['rapid', rapid], ['long', long]] as const).map(([k, r]) => (
            <div key={k} className="rounded-2xl bg-ok-soft px-3 py-2">
              <div className="flex items-center gap-1.5 text-sm text-slate-600"><PenBar type={k} />{t(PEN_NAME[k])}</div>
              <div className="text-[17px] font-bold text-ok">⭐ {r.suggest ? t(SITE_NAME[r.suggest]) : '—'}</div>
              <div className="text-xs text-slate-500">{t('الأنسب الآن · {u} من {n} في هذه الدورة', { u: r.used.size, n: r.total })}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-sm">
          {(['all', 'rapid', 'long'] as const).map((k) => (
            <button key={k} onClick={() => setType(k)} className={cx('min-h-[44px] rounded-full', type === k ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{k === 'all' ? t('الكل') : t(PEN_NAME[k])}</button>
          ))}
        </div>

        <section className="rounded-2xl border border-slate-100 bg-white p-3">
          <BodyMap allowed={allowed} last={rapid.last} suggest={type === 'long' ? long.suggest : rapid.suggest} sel={focus} onPick={(s) => setFocus((f) => (f === s ? null : s))} now={now} sensor={rapid.sensor} />
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span><i className="me-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-[#1f8a5b] bg-[#d8f5e6] align-middle" />{t('الأنسب الآن')}</span>
            <span><i className="me-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-[#f0a020] bg-[#fff1d6] align-middle" />{t('خلال يومين')}</span>
            <span><i className="me-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-[#f472b6] bg-[#fde4f0] align-middle" />{t('مرتاح')}</span>
            {rapid.sensor && <span>📡 {t('الحساس: {s} · لا إبرة فيه', { s: t(SITE_NAME[rapid.sensor]) })}</span>}
          </div>
          <p className="mt-1 text-center text-xs text-slate-500">{focus ? t('تعرض إبر {s} فقط · اضغط عليه مرة ثانية للكل', { s: t(SITE_NAME[focus]) }) : t('على كل مكان: آخر مرة استُخدم. اضغط مكانًا لترى إبره.')}</p>
        </section>

        <section className="space-y-1.5 rounded-2xl border border-slate-100 bg-white p-4">
          <div className="text-sm font-bold text-slate-500">{t('آخر 14 يوم')}</div>
          {[...counts].map(([s, n]) => (
            <button key={s} onClick={() => setFocus((f) => (f === s ? null : s))} className={cx('flex w-full items-center gap-2 rounded-lg text-start', focus === s && 'bg-brand-soft')}>
              <span className="w-24 shrink-0 text-sm">{t(SITE_NAME[s])}</span>
              <span className="h-3.5 rounded-full" style={{ width: `${(n / max) * 60 + 2}%`, background: overused.includes(s) ? '#c62f3a' : '#8a6df2' }} />
              <b className="num text-sm">{n}</b>
            </button>
          ))}
          {overused.length > 0 && <p className="pt-1 text-sm font-bold text-near">{t('{s} استُخدم كثيرًا · جرّبوا مكانًا آخر', { s: overused.map((s) => t(SITE_NAME[s])).join(' · ') })}</p>}
          {missing > 0 && <p className="pt-1 text-sm text-slate-500">{t('{n} جرعات بلا مكان مسجّل · حدّدوه من القائمة إن تذكّرتم', { n: missing })}</p>}
        </section>

        <section>
          <h2 className="mb-1.5 px-1 text-sm font-bold text-slate-500">{focus ? t(SITE_NAME[focus]) : t('الجرعات')}</h2>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
            {shown.map((e) => {
              const ms = Date.parse(e.occurred_at);
              return (
                <li key={e.id}><button onClick={() => setFix(e)} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-start active:bg-slate-50">
                  <PenBar type={penOf(e)} />
                  <span className="min-w-0 flex-1">
                    <b className={cx('block', !e.injection_site && 'text-slate-400')}>{e.injection_site ? t(SITE_NAME[e.injection_site]) : t('بلا مكان')}</b>
                    <span className="block truncate text-xs text-slate-500">{relDay(new Date(ms))} {clock(ms)} · {nameOf(e.created_by)}</span>
                  </span>
                  <span className="num text-sm">{t('{u} و', { u: e.insulin_units ?? 0 })}</span>
                  <span className="text-sm font-bold text-brand">{e.injection_site ? t('تغيير') : t('حدّد')}</span>
                </button></li>
              );
            })}
            {!shown.length && <li className="px-4 py-6 text-center text-sm text-slate-500">{t('لا جرعات')}</li>}
          </ul>
        </section>
      </div>

      <Sheet open={!!fix} onClose={() => setFix(null)} title={t('أين أُعطيت؟')}>
        {fix && <FixSite e={fix} busy={busy} onPick={(s) => void save(fix, s)} />}
      </Sheet>
    </Page>
  );
}

/** One dose's site, chosen on her map: any allowed site, the sensor's too (it may have been elsewhere then). */
function FixSite({ e, busy, onPick }: { e: EventRow; busy: boolean; onPick: (s: InjectionSite) => void }) {
  const { settings } = useData();
  const type = e.insulin_type === 'long' ? 'long' : 'rapid';
  const r = useSiteRotation(type, e.id);
  const ms = Date.parse(e.occurred_at);
  return (
    <div className={cx('space-y-2', busy && 'pointer-events-none opacity-60')}>
      <p className="text-sm text-slate-600">{t(PEN_NAME[type])} · {t('{u} و', { u: e.insulin_units ?? 0 })} · {relDay(new Date(ms))} {clock(ms)}</p>
      <BodyMap allowed={allowedSites(settings, type)} last={r.last} suggest={null} sel={e.injection_site ?? null} onPick={onPick} now={Date.now()} />
      <p className="text-center text-xs text-slate-500">{t('اضغط المكان الذي أُعطيت فيه')}</p>
    </div>
  );
}
