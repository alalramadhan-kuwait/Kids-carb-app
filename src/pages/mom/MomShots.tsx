// Mom mode: juice for a low (her usual one, then a 15-minute countdown; the server reminds both parents), «إبرة»
// (NovoRapid correction or Tresiba, in pen colours), where it was given (rotation with a suggestion), and the
// sites history.
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { saveEvent, setInjectionSite } from '../../lib/api';
import { usualLowTreatments } from '../../lib/lowUsual';
import { SITES, nextRapidAllowed, siteCounts, siteSuggestion, type Shot } from '../../engine/mom';
import { fmt } from '../../lib/carbs';
import { cx, toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import type { InjectionSite } from '../../lib/types';
import { Big, BodyMap, Choice, MomPage, PEN, PEN_NAME, PenBar, SITE_NAME, ago, clock, left } from './MomUI';

const ALL6: InjectionSite[] = ['arm_r', 'arm_l', 'belly_r', 'belly_l', 'thigh_r', 'thigh_l'];

/** Where this injection goes: the site chosen on the body page (?site=), else the rotation's suggestion. */
export function useSite(type: 'rapid' | 'long', exclude: string | null = null) {
  const [sp] = useSearchParams();
  const { events, settings } = useData();
  const allowed = (settings.injection_sites?.[type] ?? ALL6).filter((x) => SITES.includes(x));
  const shots: Shot[] = events.filter((e) => e.kind === 'insulin' && !e.deleted_at && e.id !== exclude).map((e) => ({ t: Date.parse(e.occurred_at), site: e.injection_site ?? null, type: e.insulin_type === 'long' ? 'long' : 'rapid' }));
  const r = siteSuggestion(shots, allowed);
  const asked = sp.get('site') as InjectionSite | null;
  return { ...r, allowed, site: asked && allowed.includes(asked) ? asked : r.suggest };
}

/** The site on a dose page: tap to change it on the body. */
export function SiteRow({ type, site, suggest }: { type: 'rapid' | 'long'; site: InjectionSite | null; suggest: InjectionSite | null }) {
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const back = pathname + (search.replace(/[?&]site=[^&]*/, '').replace(/^&/, '?'));
  return (
    <button onClick={() => nav(`/mom/site?type=${type}&row=1&next=${encodeURIComponent(back)}`, { replace: true })}
      className="flex min-h-[56px] w-full items-center justify-between gap-2 rounded-2xl border-2 border-slate-200 bg-white px-4 text-[18px]">
      <span>💉 {site ? t(SITE_NAME[site]) : '—'} {site && site === suggest ? '⭐' : ''}</span><span className="font-bold text-brand">{t('غيّري')}</span>
    </button>
  );
}
const withSite = (next: string, site: string) => next + (next.includes('?') ? '&' : '?') + 'site=' + site;

export function MomJuice() {
  const nav = useNavigate();
  const { history, events, settings, reload } = useData();
  const usual = useMemo(() => usualLowTreatments(history, events).filter((u, k, a) => a.findIndex((x) => x.name === u.name) === k), [history, events]);
  const [sel, setSel] = useState(0);
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const x = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(x); }, []);
  const min = settings.treat_recheck_min ?? 15;
  const give = async () => {
    const u = usual[sel] ?? { name: 'عصير', carbs: 15 }; // i18n-ok: stored value
    setBusy(true);
    try {
      await saveEvent({ client_id: crypto.randomUUID(), kind: 'treatment', occurred_at: new Date().toISOString(), carbs_g: u.carbs, treatment: u.name,
        insulin_units: null, insulin_type: null, bolus_purpose: null, note: null, activity_min: null, activity_level: null, ends_at: null, dose_calc: null, bg_mgdl: null });
      await reload(); setDoneAt(Date.now());
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  if (doneAt) {
    const due = doneAt + min * 60000, secs = Math.max(0, Math.round((due - now) / 1000));
    return (
      <MomPage title={t('تم: عطيتها العصير ✓')} back="/mom" foot={<Big tone="ghost" onClick={() => nav('/mom', { replace: true })}>{t('تم')}</Big>}>
        <div className="rounded-3xl bg-white p-6 text-center">
          <div className="text-slate-500">{t('افحصيها بعد')}</div>
          <div className="num text-[64px] font-extrabold text-brand" dir="ltr">{secs ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : t('الحين')}</div>
          <div className="text-slate-500">{clock(due)}</div>
        </div>
        <p className="text-center text-[16px] text-slate-500">{t('بيوصلج تذكير')}</p>
      </MomPage>
    );
  }
  return (
    <MomPage title={t('عصير')} back="/mom" foot={<Big tone="danger" disabled={busy} onClick={give}>🧃 {t('عطيتها')}</Big>}>
      {usual.length ? usual.map((u, k) => <Choice key={u.name + u.carbs} icon="🧃" label={tMaybe(u.name)} sub={`${fmt(u.carbs)} ${t('غرام')}`} on={sel === k} onClick={() => setSel(k)} />)
        : <Choice icon="🧃" label={t('عصير')} sub={`15 ${t('غرام')}`} on onClick={() => undefined} />}
    </MomPage>
  );
}

export function MomShot() {
  const nav = useNavigate();
  const { events, settings } = useData();
  const now = Date.now();
  const shots = events.filter((e) => e.kind === 'insulin' && !e.deleted_at);
  const last = (long: boolean) => shots.filter((e) => (e.insulin_type === 'long') === long).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0] ?? null;
  const lr = last(false), ll = last(true);
  const nextAt = nextRapidAllowed(lr ? Date.parse(lr.occurred_at) : null, settings.dose_gap_min ?? 120, now);
  const longToday = ll && now - Date.parse(ll.occurred_at) < 20 * 3600000;
  const Card = ({ type, sub, onClick, off }: { type: 'rapid' | 'long'; sub: string; onClick: () => void; off?: string | null }) => (
    <button onClick={onClick} disabled={!!off} className="flex w-full items-center gap-4 rounded-3xl border-[3px] bg-white px-4 py-4 text-start disabled:opacity-50" style={{ borderColor: PEN[type], background: type === 'rapid' ? '#fff3e6' : '#f1f9e6', color: '#231b3d' }}>
      <span className="h-16 w-4 rounded-full" style={{ background: PEN[type] }} />
      <span className="flex-1"><b className="block text-[24px]">{t(PEN_NAME[type])}</b><span className="text-[15px]" style={{ color: '#4b4565' }}>{off ?? sub}</span></span>
    </button>
  );
  return (
    <MomPage title={t('أي إبرة؟')} back="/mom">
      <Card type="rapid" sub={lr ? t('آخر وحدة {u} · {when}', { u: lr.insulin_units ?? 0, when: ago(Date.parse(lr.occurred_at)) }) : t('السريعة')}
        off={nextAt ? t('لا نوفورابيد قبل الساعة {c}', { c: clock(nextAt) }) : null} onClick={() => nav(`/mom/site?type=rapid&next=${encodeURIComponent('/mom/dose?correction=1')}`)} />
      <Card type="long" sub={longToday ? t('انعطت {when} · {u} وحدة', { when: ago(Date.parse(ll!.occurred_at)), u: ll!.insulin_units ?? 0 }) : t('ما انعطت اليوم')} onClick={() => nav(longToday ? '/mom/tresiba' : `/mom/site?type=long&next=${encodeURIComponent('/mom/tresiba')}`)} />
    </MomPage>
  );
}

export function MomTresiba() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { events, reload } = useData();
  const { site, suggest } = useSite('long');
  const last = events.filter((e) => e.kind === 'insulin' && e.insulin_type === 'long' && !e.deleted_at).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0] ?? null;
  const [u, setU] = useState<number>(last?.insulin_units ?? 0);
  const [busy, setBusy] = useState(false);
  // Tresiba is once a day: given in the last 20 hours stops here, and going on needs a second, deliberate tap
  const again = sp.get('again') === '1';
  const recent = last && Date.now() - Date.parse(last.occurred_at) < 20 * 3600000;
  const save = async () => {
    setBusy(true);
    try {
      await saveEvent({ client_id: crypto.randomUUID(), kind: 'insulin', occurred_at: new Date().toISOString(), insulin_units: u, insulin_type: 'long', bolus_purpose: null,
        carbs_g: null, treatment: null, note: null, activity_min: null, activity_level: null, ends_at: null, dose_calc: null, bg_mgdl: null, injection_site: site });
      await reload();
      toast(t('تم تسجيل الإبرة ✓'));
      nav('/mom', { replace: true });
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };
  if (recent && !again) return (
    <MomPage title={t(PEN_NAME.long)} back="/mom/shot" foot={<>
      <Big onClick={() => nav('/mom', { replace: true })}>{t('تمام · رجوع')}</Big>
      <button className="min-h-[44px] w-full text-[16px] text-over underline" onClick={() => { if (window.confirm(t('تريسيبا مرة ثانية اليوم؟ كلّمي بابا أول'))) nav(`/mom/site?type=long&next=${encodeURIComponent('/mom/tresiba?again=1')}`, { replace: true }); }}>{t('لازم مرة ثانية')}</button>
    </>}>
      <div className="rounded-3xl border-2 border-over/40 bg-over-soft p-5 text-center">
        <div className="text-5xl">✋</div>
        <div className="mt-2 text-[24px] font-bold text-over">{t('انعطت اليوم')}</div>
        <div className="mt-2 text-[20px]"><b className="num">{last!.insulin_units}</b> {t('وحدة')} · {clock(Date.parse(last!.occurred_at))}</div>
        <div className="text-[16px] text-slate-600">{ago(Date.parse(last!.occurred_at))}</div>
      </div>
    </MomPage>
  );
  return (
    <MomPage title={t(PEN_NAME.long)} back="/mom/shot" foot={<Big disabled={busy || u <= 0} onClick={save} className="!bg-[#6aa62a]">💉 {t('سجّلي الإبرة')}</Big>}>
      <div className="flex items-center justify-center gap-3"><PenBar type="long" /><span className="text-[18px]">{last ? t('آخر مرة {u} وحدة', { u: last.insulin_units ?? 0 }) : ''}</span></div>
      <div className="flex items-center justify-center gap-6">
        <button aria-label="+" className="grid h-16 w-16 place-items-center rounded-full text-4xl font-bold" style={{ background: '#f1f9e6', color: '#3d6b12' }} onClick={() => setU(u + 1)}>+</button>
        <span className="num w-20 text-center text-[56px] font-extrabold">{u}</span>
        <button aria-label="−" className="grid h-16 w-16 place-items-center rounded-full text-4xl font-bold" style={{ background: '#f1f9e6', color: '#3d6b12' }} onClick={() => setU(Math.max(0, u - 1))}>−</button>
      </div>
      <p className="text-center text-[18px]">{t('وحدة')}</p>
      <SiteRow type="long" site={site} suggest={suggest} />
    </MomPage>
  );
}

/** Where was it given: the body, the suggested site (used longest ago) in green, tap to choose. */
export function MomSite() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const id = sp.get('e'), type = (sp.get('type') === 'long' ? 'long' : 'rapid') as 'rapid' | 'long', next = sp.get('next') ?? '/mom';
  const { events, reload } = useData();
  const { suggest, last, allowed, used, total } = useSite(type, id);
  const [sel, setSel] = useState<InjectionSite | null>(() => events.find((e) => e.id === id)?.injection_site ?? null);
  const pick = sel ?? suggest;
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!pick) return;
    setBusy(true);
    try { if (id) { await setInjectionSite(id, pick); await reload(); nav(next, { replace: true }); } else nav(withSite(next, pick), { replace: true }); }
    catch (e) { toast((e as Error).message); setBusy(false); }
  };
  return (
    <MomPage title={id ? t('وين عطيتيها؟') : t('وين الإبرة؟')} back={id ? null : sp.get('row') ? next : -1} foot={<>
      <Big disabled={busy || !pick} onClick={save}>✓ {pick ? t(SITE_NAME[pick]) : ''}</Big>
      {id && <button className="min-h-[44px] w-full text-[16px] text-slate-500" onClick={() => { void reload(); nav(next, { replace: true }); }}>{t('بعدين')}</button>}
    </>}>
      <div className="flex items-center gap-2"><PenBar type={type} /><b className="text-[18px]">{t(PEN_NAME[type])}</b></div>
      {suggest && <div className="rounded-2xl bg-ok-soft px-4 py-2 text-center text-[18px] font-bold text-ok">⭐ {t(SITE_NAME[suggest])} {used.size > 0 && <span className="text-[15px] font-normal">· {t('باقي {k} أماكن', { k: total - used.size })}</span>}</div>}
      <BodyMap allowed={allowed} last={last} suggest={suggest} sel={pick} onPick={setSel} now={Date.now()} />
    </MomPage>
  );
}

export function MomSites() {
  const { events, settings } = useData();
  const [type, setType] = useState<'all' | 'rapid' | 'long'>('all');
  const now = Date.now();
  const allowed = [...new Set([...(settings.injection_sites?.rapid ?? ALL6), ...(settings.injection_sites?.long ?? ALL6)])];
  const shots = events.filter((e) => e.kind === 'insulin' && !e.deleted_at && (type === 'all' || (type === 'long') === (e.insulin_type === 'long')))
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const { counts, overused } = siteCounts(shots.map((e) => ({ t: Date.parse(e.occurred_at), site: e.injection_site ?? null, type: e.insulin_type === 'long' ? 'long' : 'rapid' })), now, allowed);
  const max = Math.max(1, ...counts.values());
  return (
    <MomPage title={t('أماكن الإبر')} back="/mom/more">
      <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-[15px]">
        {(['all', 'rapid', 'long'] as const).map((k) => <button key={k} onClick={() => setType(k)} className={cx('min-h-[44px] rounded-full', type === k ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{k === 'all' ? t('الكل') : t(PEN_NAME[k])}</button>)}
      </div>
      <div className="space-y-1.5 rounded-3xl bg-white p-4">
        <div className="text-sm text-slate-500">{t('آخر 14 يوم')}</div>
        {[...counts].map(([s, n]) => (
          <div key={s} className="flex items-center gap-2"><span className="w-24 text-[15px]">{t(SITE_NAME[s])}</span><span className="h-4 rounded-full" style={{ width: `${(n / max) * 60 + 2}%`, background: overused.includes(s) ? '#c62f3a' : '#8a6df2' }} /><b className="num">{n}</b></div>
        ))}
      </div>
      {overused.length > 0 && <p className="rounded-2xl bg-near-soft px-4 py-3 text-[16px] font-bold text-near">{t('{s} وايد · جربي مكان ثاني', { s: overused.map((s) => t(SITE_NAME[s])).join(' · ') })}</p>}
      <ul className="divide-y divide-slate-100 rounded-3xl bg-white px-4">
        {shots.slice(0, 20).map((e) => (
          <li key={e.id}><Link to={`/mom/entry/${e.id}`} className="flex items-center gap-3 py-2.5"><PenBar type={e.insulin_type === 'long' ? 'long' : 'rapid'} />
            <span className="flex-1"><b className="block">{e.injection_site ? t(SITE_NAME[e.injection_site]) : '—'}</b><span className="text-sm text-slate-500">{ago(Date.parse(e.occurred_at), now)}</span></span>
            <span className="text-[16px]">{e.insulin_units} {t('وحدة')} ›</span></Link></li>
        ))}
      </ul>
    </MomPage>
  );
}
