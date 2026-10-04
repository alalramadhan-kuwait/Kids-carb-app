// Mom mode home: how Layan is now (big coloured box like LibreLinkUp), a large simple 12-hour graph, the last
// injections in pen colours with the doctor's 2-hour countdown, the meal in progress, and three big buttons.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../../lib/data';
import { useGlucose } from '../../hooks/useGlucose';
import { fetchSeries } from '../../engine/useSeries';
import { mergeSeries, type Series } from '../../engine/series';
import { levelFromLibre, trendFrom } from '../../engine/trend';
import { effectiveRange } from '../../lib/glucose';
import { moodOf, nextRapidAllowed, type Mood } from '../../engine/mom';
import { usePlans } from '../../lib/plans';
import { setFullModeNow } from '../../lib/mom';
import { cx } from '../../components/ui';
import { t } from '../../i18n';
import { Big, PEN, PEN_NAME, PenBar, ago, clock, glucoseText, left } from './MomUI';

const H = 3600000;
const ARROW: Record<number, string> = { [-3]: '⇊', [-2]: '↓', [-1]: '↘', 0: '→', 1: '↗', 2: '↑', 3: '⇈' };
const MOOD: Record<Mood, { bg: string; word: string; todo: string }> = {
  ok: { bg: 'bg-[#2f8f55]', word: 'زين', todo: 'ما يحتاج شي الحين' }, // i18n-ok
  falling: { bg: 'bg-[#c27a00]', word: 'قاعد ينزل', todo: 'انتبهي وافحصيها' }, // i18n-ok
  high: { bg: 'bg-[#c27a00]', word: 'مرتفع', todo: 'شوفي خطة الدكتور' }, // i18n-ok
  low: { bg: 'bg-[#c62f3a]', word: 'نازل', todo: 'عطيها عصير الحين' }, // i18n-ok
  stale: { bg: 'bg-slate-500', word: 'ما في قراءة جديدة', todo: 'افحصيها بالإصبع' }, // i18n-ok
}; // i18n: translated where shown

export function MomHome() {
  const nav = useNavigate();
  const { settings: s, events, history } = useData();
  const { g } = useGlucose();
  const [now, setNow] = useState(Date.now());
  const [series, setSeries] = useState<Series | null>(null);
  useEffect(() => {
    const load = () => { setNow(Date.now()); void fetchSeries(Date.now() - 12 * H, Date.now() + 60000).then(setSeries).catch(() => undefined); };
    load(); const id = setInterval(load, 60000); return () => clearInterval(id);
  }, []);
  const merged = useMemo(() => {
    if (!series) return null;
    // the graph's own readings, plus only the live ones newer than them (one source per moment: no zigzags)
    const lastT = series.t.length ? series.t[series.t.length - 1] : 0;
    const r = (g?.readings ?? []).filter((x) => Date.parse(x.taken_at) > lastT + 60000);
    return mergeSeries(series, r.map((x) => Date.parse(x.taken_at)), r.map((x) => x.mg_dl));
  }, [series, g]);
  const unit = s.glucose_unit;
  const range = effectiveRange(s.glucose_low_mgdl, s.glucose_high_mgdl);
  const low = s.alert_low_mgdl ?? range.low ?? 70, high = range.high ?? 180;
  const latest = g?.latest ?? null;
  const at = latest ? Date.parse(latest.taken_at) : null;
  const tr = g ? trendFrom(g.readings, now) : null;
  const level = tr?.level ?? (latest ? levelFromLibre(latest.trend) : null);
  const mood = moodOf(latest?.mg_dl ?? null, at === null ? null : (now - at) / 60000, level, low, high);
  const m = MOOD[mood];

  const shots = events.filter((e) => e.kind === 'insulin' && !e.deleted_at && e.insulin_units);
  const lastOf = (type: 'rapid' | 'long') => shots.filter((e) => (type === 'long' ? e.insulin_type === 'long' : e.insulin_type !== 'long')).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0] ?? null;
  const lastRapid = lastOf('rapid'), lastLong = lastOf('long');
  const nextAt = nextRapidAllowed(lastRapid ? Date.parse(lastRapid.occurred_at) : null, s.dose_gap_min ?? 120, now);
  const { plans } = usePlans();
  const open = plans.filter((p) => p.status === 'dosed' && now - Date.parse(p.dose_at) < 6 * H).sort((a, b) => Date.parse(b.dose_at) - Date.parse(a.dose_at))[0] ?? null;
  const lowNow = mood === 'low';
  // a juice given: its recheck stays on home until someone taps «فحصتها»
  const recheckMin = s.treat_recheck_min ?? 15;
  const lastJuice = events.filter((e) => e.kind === 'treatment' && !e.deleted_at).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0] ?? null;
  const [acked, setAcked] = useState<string | null>(() => { try { return localStorage.getItem('mom-juice-ack'); } catch { return null; } });
  const juice = lastJuice && lastJuice.id !== acked && now - Date.parse(lastJuice.occurred_at) < (recheckMin + 45) * 60000 ? lastJuice : null;
  const juiceDue = juice ? Date.parse(juice.occurred_at) + recheckMin * 60000 : 0;
  const ack = () => { if (!juice) return; try { localStorage.setItem('mom-juice-ack', juice.id); } catch { /* blocked */ } setAcked(juice.id); };

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-3 px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
      <div className="flex items-baseline justify-between"><b className="text-[22px]">{t('ليان')}</b><span className="text-sm text-slate-500">{at ? ago(at, now) : ''}</span></div>
      <div className={cx('flex items-center gap-4 rounded-3xl px-5 py-4', m.bg)} style={{ color: '#fff' }}>
        <div className="min-w-0 flex-1"><div className="text-[22px] font-bold leading-tight">{t(m.word)}</div><div className="text-[16px] opacity-90">{t(m.todo)}</div></div>
        {latest && mood !== 'stale' && <div dir="ltr" className="flex items-baseline gap-1.5"><span className="text-[56px] font-extrabold leading-none">{glucoseText(latest.mg_dl, unit)}</span><span className="text-[34px]">{level !== null ? ARROW[level] : ''}</span></div>}
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white px-1 pb-1 pt-2">
        {merged ? <BigGraph s={merged} now={now} unit={unit} low={low} high={high} band={[range.low ?? 70, high]} alarmHigh={s.alert_high_mgdl ?? 240}
          shots={shots.map((e) => ({ t: Date.parse(e.occurred_at), u: e.insulin_units!, type: e.insulin_type === 'long' ? 'long' as const : 'rapid' as const }))}
          meals={history.filter((h) => h.total_carbs >= 5).map((h) => Date.parse(h.eaten_at))} /> : <div className="h-[260px]" />}
        <div className="flex justify-center gap-4 pb-1 text-xs text-slate-500"><span><b style={{ color: PEN.rapid }}>●</b> {t(PEN_NAME.rapid)}</span><span><b style={{ color: PEN.long }}>●</b> {t(PEN_NAME.long)}</span><span>🍽️ {t('أكل')}</span></div>
      </div>

      <div className="space-y-2 rounded-3xl border border-slate-100 bg-white px-4 py-3">
        {[lastRapid && { type: 'rapid' as const, e: lastRapid }, lastLong && { type: 'long' as const, e: lastLong }].filter(Boolean).map((x) => x && (
          <Link key={x.type} to={`/mom/entry/${x.e.id}`} className="flex min-h-[44px] items-center gap-3"><PenBar type={x.type} /><span className="flex-1 text-[17px]">{t(PEN_NAME[x.type])} <b className="num">{x.e.insulin_units}</b> {t('وحدة')}</span><span className="text-[15px] text-slate-500">{ago(Date.parse(x.e.occurred_at), now)}</span></Link>
        ))}
        {nextAt && !lowNow && <div className="rounded-xl bg-near-soft px-3 py-2 text-[16px] font-bold text-near">{t('لا نوفورابيد قبل الساعة {c}', { c: clock(nextAt) })}</div>}
      </div>

      {juice && (
        <Link to={`/mom/entry/${juice.id}`} className="flex items-center gap-3 rounded-3xl bg-near-soft px-4 py-3 text-near">
          <span className="text-3xl">🧃</span>
          <span className="flex-1 text-[17px] font-bold">{t('عصير {c}', { c: clock(Date.parse(juice.occurred_at)) })} · {juiceDue > now ? t('افحصيها بعد {m}', { m: left(juiceDue, now) }) : t('افحصيها الحين')}</span>
        </Link>
      )}

      {/* one main button: the next step of whatever is going on */}
      {juice ? <Big className="min-h-[72px] text-[22px]" onClick={ack}>✓ {t('فحصتها')}</Big>
        : lowNow ? <Big tone="danger" className="min-h-[72px] text-[22px]" onClick={() => nav('/mom/juice')}>🧃 {t('عطيتها عصير')}</Big>
        : open ? <Big className="min-h-[72px] text-[22px]" onClick={() => nav(open.eating_at ? `/mom/ate/${open.id}` : `/mom/given/${open.id}`)}>🍽️ {open.eating_at ? t('شكثر أكلت؟') : t('بدأت تاكل؟')}</Big>
        : <Big className="min-h-[72px] text-[22px]" onClick={() => nav('/mom/meal')}>🍽️ {t('جهزي وجبتها')}</Big>}
      <div className="grid grid-cols-2 gap-2">
        {lowNow || juice ? <Big tone="ghost" disabled={lowNow} onClick={() => nav('/mom/meal')}>🍽️ {t('وجبة')}</Big> : <Big tone="ghost" onClick={() => nav('/mom/juice')}>🧃 {t('عصير')}</Big>}
        <Big tone="ghost" disabled={lowNow} onClick={() => nav('/mom/shot')}>💉 {t('إبرة')}</Big>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[15px]">
        <Link to="/mom/sites" className="min-h-[44px] rounded-full bg-white px-4 py-2.5 font-bold">💉 {t('أماكن الإبر')}</Link>
        <button className="min-h-[44px] px-2 text-slate-500 underline" onClick={() => { if (window.confirm(t('تفتحين الوضع الكامل؟'))) { setFullModeNow(true); nav('/'); } }}>{t('الوضع الكامل')}</button>
      </div>
      <p className="text-center text-[13px] text-slate-500">{t('الأرقام من خطة الدكتور')}</p>
    </main>
  );
}

/** LibreLinkUp-style graph: last 12 h, fixed axis, target band, dashed low (red) and high (orange) lines, big last dot. */
function BigGraph({ s, now, unit, low, high, band, alarmHigh, shots, meals }: { s: Series; now: number; unit: 'mmol' | 'mgdl'; low: number; high: number; band: [number, number]; alarmHigh: number; shots: { t: number; u: number; type: 'rapid' | 'long' }[]; meals: number[] }) {
  const W = 340, PL = 6, PR = 30, PT = 8, PH = 220, HH = PT + PH + 44;
  const t0 = now - 12 * H;
  const top = unit === 'mmol' ? 21 * 18.016 : 350, bottom = unit === 'mmol' ? 3 * 18.016 : 50;
  const ticks = unit === 'mmol' ? [3, 6, 9, 12, 15, 18, 21].map((v) => v * 18.016) : [50, 100, 150, 200, 250, 300, 350];
  const x = (t: number) => PL + ((t - t0) / (12 * H)) * (W - PL - PR);
  const y = (v: number) => PT + PH - ((Math.min(Math.max(v, bottom), top) - bottom) / (top - bottom)) * PH;
  let d = '', prev = 0, lastV: number | null = null, lastT = 0;
  for (let i = 0; i < s.t.length; i++) {
    const t = s.t[i]; if (t < t0 || t > now + 60000) continue;
    d += `${!d || t - prev > 20 * 60000 ? 'M' : 'L'}${x(t).toFixed(1)},${y(s.v[i]).toFixed(1)}`; prev = t; lastV = s.v[i]; lastT = t;
  }
  const dot = lastV === null ? '#64748b' : lastV < low ? '#c62f3a' : lastV > high ? '#c27a00' : '#2f8f55'; // the newest reading drawn, same as the box
  const first = Math.ceil(t0 / (3 * H)) * 3 * H; const hours = [0, 1, 2, 3].map((k) => first + k * 3 * H).filter((h) => h <= now);
  return (
    <svg viewBox={`0 0 ${W} ${HH}`} className="w-full" direction="ltr" role="img" aria-label={t('السكر آخر 12 ساعة')}>
      <rect x={PL} y={y(band[1])} width={W - PL - PR} height={y(band[0]) - y(band[1])} fill="#2f8f55" opacity="0.14" />
      {ticks.map((v) => <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="rgb(var(--text-3))" strokeOpacity="0.25" /><text x={W - PR + 4} y={y(v) + 4} fontSize="14" fill="#8a84a0">{glucoseText(v, unit).replace(/\.0$/, '')}</text></g>)}
      <line x1={PL} x2={W - PR} y1={y(alarmHigh)} y2={y(alarmHigh)} stroke="#f0a020" strokeWidth="2" strokeDasharray="6 5" />
      <line x1={PL} x2={W - PR} y1={y(low)} y2={y(low)} stroke="#d6303c" strokeWidth="2" strokeDasharray="6 5" />
      <path d={d} fill="none" stroke="rgb(var(--text))" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
      {lastV !== null && <circle cx={x(lastT)} cy={y(lastV)} r="8" fill={dot} stroke="#fff" strokeWidth="3" />}
      {meals.filter((m) => m >= t0 && m <= now).map((m) => <text key={m} x={x(m)} y={PT + PH + 12} fontSize="13" textAnchor="middle">🍽️</text>)}
      {shots.filter((e) => e.t >= t0 && e.t <= now).map((e) => <g key={e.t}><circle cx={x(e.t)} cy={PT + PH + 26} r="9" fill={PEN[e.type]} /><text x={x(e.t)} y={PT + PH + 30} fontSize="10" fontWeight="700" fill="#fff" textAnchor="middle">{e.u}</text></g>)}
      {hours.map((h) => <text key={h} x={x(h)} y={HH - 2} fontSize="11" fill="#8a84a0" textAnchor="middle">{clock(h)}</text>)}
    </svg>
  );
}
