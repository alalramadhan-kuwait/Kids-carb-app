// Mom mode home: how Layan is now (big coloured box like LibreLinkUp), a large simple 12-hour graph, the last
// injections in pen colours with the doctor's 2-hour countdown, the meal in progress, and three big buttons.
import { useEffect, useMemo, useRef, useState, type PointerEvent as PE } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { useGlucose } from '../../hooks/useGlucose';
import { fetchSeries } from '../../engine/useSeries';
import { mergeSeries, type Series } from '../../engine/series';
import { levelFromLibre, trendFrom } from '../../engine/trend';
import { effectiveRange } from '../../lib/glucose';
import { moodOf, nextRapidAllowed, type Mood } from '../../engine/mom';
import { usePlans } from '../../lib/plans';
import { draftOps, useSensor } from '../../lib/mom';
import { phase } from '../../engine/mealPlan';
import { cx } from '../../components/ui';
import { SameMealLink, useRecentSame } from '../../components/SameMeal';
import { t } from '../../i18n';
import { Big, PEN, PEN_NAME, PenBar, TABS_PAD, ago, clock, dayWord, glucoseText, left, sensorLeft } from './MomUI';

const H = 3600000;
const ARROW: Record<number, string> = { [-3]: '⇊', [-2]: '↓', [-1]: '↘', 0: '→', 1: '↗', 2: '↑', 3: '⇈' };
const MOOD: Record<Mood, { bg: string; word: string; todo: string }> = {
  ok: { bg: '#2f8f55', word: 'زين', todo: 'ما يحتاج شي الحين' }, // i18n-ok
  falling: { bg: '#c27a00', word: 'قاعد ينزل', todo: 'انتبهي وافحصيها' }, // i18n-ok
  high: { bg: '#c27a00', word: 'مرتفع', todo: 'شوفي خطة الدكتور' }, // i18n-ok
  low: { bg: '#c62f3a', word: 'نازل', todo: 'عطيها عصير الحين' }, // i18n-ok
  stale: { bg: '#64748b', word: 'ما في قراءة جديدة', todo: 'افحصيها بالإصبع' }, // i18n-ok
}; // i18n: translated where shown

export function MomHome() {
  const nav = useNavigate();
  const focusAt = Number(useSearchParams()[0].get('at')) || null; // a tapped "Rawan added …" push
  const same = useRecentSame();
  // the graph fills its box: its drawing height follows the box's shape (no empty bands on tall phones)
  const box = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(0.8);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setAspect(r.height / r.width); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
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
  // a planned meal (on hold): due now → the main button; otherwise the next one as a small line
  const waiting = plans.filter((p) => p.status === 'planned' && phase(p, now) !== 'done').sort((a, b) => Date.parse(a.dose_at) - Date.parse(b.dose_at));
  const due = waiting.find((p) => phase(p, now) === 'check') ?? null;
  const next = due ? null : waiting.find((p) => Date.parse(p.dose_at) - now < 18 * H) ?? null;
  const build = (mode: 'now' | 'plan') => { draftOps.start(mode); nav('/mom/meal'); };
  // the sensor: days left in the status line; its last day, or an unknown arm, gets a card
  const sensor = useSensor();
  const sensorSoon = sensor && sensor.life.state !== 'ok';
  // a juice given: its recheck stays on home until someone taps «فحصتها»
  const recheckMin = s.treat_recheck_min ?? 15;
  const lastJuice = events.filter((e) => e.kind === 'treatment' && !e.deleted_at).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0] ?? null;
  const [acked, setAcked] = useState<string | null>(() => { try { return localStorage.getItem('mom-juice-ack'); } catch { return null; } });
  const juice = lastJuice && lastJuice.id !== acked && now - Date.parse(lastJuice.occurred_at) < (recheckMin + 45) * 60000 ? lastJuice : null;
  const juiceDue = juice ? Date.parse(juice.occurred_at) + recheckMin * 60000 : 0;
  const ack = () => { if (!juice) return; try { localStorage.setItem('mom-juice-ack', juice.id); } catch { /* blocked */ } setAcked(juice.id); };

  const big = 'min-h-[60px] text-[21px]';
  return (
    // one fixed screen: nothing scrolls; the graph takes whatever room is left
    <main className={cx('mx-auto flex h-[100dvh] max-w-md flex-col gap-2 overflow-hidden px-4 pt-[calc(8px+env(safe-area-inset-top))]', TABS_PAD)}>
      <div className="flex shrink-0 items-center gap-3 rounded-3xl px-4 py-2.5" style={{ color: '#fff', background: m.bg }}>
        <div className="min-w-0 flex-1"><div className="text-[14px] opacity-90">{t('ليان')} · {at ? ago(at, now) : ''}{sensor ? ` · 📡 ${sensorLeft(sensor.life.left)}` : ''}</div><div className="text-[20px] font-bold leading-tight">{t(m.word)}</div><div className="text-[15px] opacity-90">{t(m.todo)}</div></div>
        {latest && mood !== 'stale' && <div dir="ltr" className="flex items-baseline gap-1"><span className="text-[48px] font-extrabold leading-none">{glucoseText(latest.mg_dl, unit)}</span><span className="text-[30px]">{level !== null ? ARROW[level] : ''}</span></div>}
      </div>

      <div className="flex max-h-[50dvh] min-h-[120px] flex-1 flex-col rounded-3xl border border-slate-100 bg-white px-1 pt-1">
        <div ref={box} className="min-h-0 flex-1">
          {merged && <BigGraph key={focusAt ?? 0} at={focusAt} aspect={aspect} s={merged} now={now} unit={unit} low={low} high={high} band={[range.low ?? 70, high]} alarmHigh={s.alert_high_mgdl ?? 240}
            shots={shots.map((e) => ({ t: Date.parse(e.occurred_at), u: e.insulin_units!, type: e.insulin_type === 'long' ? 'long' as const : 'rapid' as const }))}
            meals={history.filter((h) => h.total_carbs >= 5).map((h) => Date.parse(h.eaten_at))}
            treats={events.filter((e) => e.kind === 'treatment' && !e.deleted_at).map((e) => Date.parse(e.occurred_at))}
            pricks={events.filter((e) => e.kind === 'bg_check' && !e.deleted_at).map((e) => Date.parse(e.occurred_at))} />}
        </div>
      </div>

      <div className="shrink-0 rounded-3xl border border-slate-100 bg-white px-4 py-1.5">
        {[lastRapid && { type: 'rapid' as const, e: lastRapid }, lastLong && { type: 'long' as const, e: lastLong }].filter(Boolean).map((x) => x && (
          <Link key={x.type} to={`/mom/entry/${x.e.id}`} className="flex min-h-[40px] items-center gap-3"><PenBar type={x.type} /><span className="flex-1 text-[17px]">{t(PEN_NAME[x.type])} <b className="num">{x.e.insulin_units}</b> {t('وحدة')}</span><span className="text-[15px] text-slate-500">{ago(Date.parse(x.e.occurred_at), now)}</span></Link>
        ))}
        {nextAt && !lowNow && <div className="mb-1 rounded-xl bg-near-soft px-3 py-1.5 text-[16px] font-bold text-near">{t('لا نوفورابيد قبل الساعة {c}', { c: clock(nextAt) })}</div>}
      </div>

      {same && <SameMealLink short to={`/mom/same/${same.target.id}`} target={same.target} matches={same.matches}
        className="flex min-h-[48px] shrink-0 items-center gap-2 rounded-3xl bg-brand-soft px-4 py-2 text-[17px] font-bold text-brand" />}

      {sensor && (sensorSoon || !sensor.site) && (
        <Link to="/mom/sensor" className={cx('flex shrink-0 items-center gap-3 rounded-2xl px-4 py-2 text-[16px] font-bold', sensorSoon ? 'bg-over-soft text-over' : 'bg-white text-brand')}>
          <span className="text-2xl">📡</span>
          <span className="flex-1">{sensorSoon ? t('الحساس ينتهي {d} {c}', { d: dayWord(sensor.life.end, now), c: clock(sensor.life.end) }) : t('الحساس بأي ذراع؟')}</span><span>›</span>
        </Link>
      )}

      {juice && (
        <Link to={`/mom/entry/${juice.id}`} className="flex shrink-0 items-center gap-3 rounded-2xl bg-near-soft px-4 py-2 text-near">
          <span className="text-2xl">🧃</span>
          <span className="flex-1 text-[16px] font-bold">{t('عصير {c}', { c: clock(Date.parse(juice.occurred_at)) })} · {juiceDue > now ? t('افحصيها بعد {m}', { m: left(juiceDue, now) }) : t('افحصيها الحين')}</span>
        </Link>
      )}

      {/* one main button: the next step of whatever is going on (kept at the bottom when the graph leaves room) */}
      <div className="mt-auto shrink-0">
        {juice ? <Big className={big} onClick={ack}>✓ {t('فحصتها')}</Big>
          : lowNow ? <Big tone="danger" className={big} onClick={() => nav('/mom/juice')}>🧃 {t('عطيتها عصير')}</Big>
          : open ? <Big className={big} onClick={() => nav(open.eating_at ? `/mom/ate/${open.id}` : `/mom/given/${open.id}`)}>🍽️ {open.eating_at ? t('شكثر أكلت؟') : t('بدأت تاكل؟')}</Big>
          : due ? <Big className={big} onClick={() => nav(`/mom/plan/${due.id}`)}>💉 {t('وقت {x}', { x: due.name })}</Big>
          : <div className="grid grid-cols-2 gap-2">
              <Big className={big} onClick={() => build('now')}>🍽️ {t('أضيفي وجبة')}</Big>
              <Big tone="soft" className={big} onClick={() => build('plan')}>📅 {t('خططي وجبة')}</Big>
            </div>}
      </div>
      {next && <Link to={`/mom/plan/${next.id}`} className="shrink-0 rounded-2xl bg-white px-4 py-2 text-[16px]">📅 <bdi>{next.name}</bdi> · {dayWord(Date.parse(next.dose_at))} 💉 {clock(Date.parse(next.dose_at))} ›</Link>}
      <div className="grid shrink-0 grid-cols-3 gap-2">
        {lowNow || juice ? <Big tone="ghost" className="min-h-[52px] text-[18px]" disabled={lowNow} onClick={() => build('now')}>🍽️ {t('وجبة')}</Big> : <Big tone="ghost" className="min-h-[52px] text-[18px]" onClick={() => nav('/mom/juice')}>🧃 {t('عصير')}</Big>}
        <Big tone="ghost" className="min-h-[52px] text-[18px]" disabled={lowNow} onClick={() => nav('/mom/shot')}>💉 {t('إبرة')}</Big>
        <Big tone="ghost" className="min-h-[52px] !px-2 text-[18px]" onClick={() => nav('/mom/prick')}>🩸 {t('وخز')}</Big>
      </div>
    </main>
  );
}

/** LibreLinkUp-style graph: last 12 h, fixed axis, target band, dashed low (red) and high (orange) lines, big last dot. */
/** A monotone cubic curve (Fritsch–Carlson) through the points: smooth, and never above or below the real values
 *  between two of them. Breaks into separate pieces where readings are missing for longer than `gap`. */
function smoothPath(p: { x: number; y: number; t: number }[], gap: number): string {
  let d = '';
  const runs: typeof p[] = [];
  for (const q of p) { const r = runs[runs.length - 1]; if (r && q.t - r[r.length - 1].t <= gap) r.push(q); else runs.push([q]); }
  for (const r of runs) {
    d += `M${r[0].x.toFixed(1)},${r[0].y.toFixed(1)}`;
    if (r.length < 2) continue;
    const k = r.length, dx: number[] = [], m: number[] = [], tan: number[] = [];
    for (let i = 0; i < k - 1; i++) { dx[i] = r[i + 1].x - r[i].x; m[i] = dx[i] ? (r[i + 1].y - r[i].y) / dx[i] : 0; }
    tan[0] = m[0]; tan[k - 1] = m[k - 2];
    for (let i = 1; i < k - 1; i++) tan[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    for (let i = 0; i < k - 1; i++) {
      const h = dx[i] / 3;
      d += `C${(r[i].x + h).toFixed(1)},${(r[i].y + tan[i] * h).toFixed(1)} ${(r[i + 1].x - h).toFixed(1)},${(r[i + 1].y - tan[i + 1] * h).toFixed(1)} ${r[i + 1].x.toFixed(1)},${r[i + 1].y.toFixed(1)}`;
    }
  }
  return d;
}

/** One row of markers under the graph: each at its time, moved just enough sideways never to sit on the previous one. */
function lane<T extends { t: number }>(items: T[], x: (t: number) => number, right: number, gap = 19): (T & { x: number; k: string })[] {
  const out: (T & { x: number; k: string })[] = [];
  for (const it of [...items].sort((a, b) => a.t - b.t)) {
    const prev = out[out.length - 1];
    out.push({ ...it, x: Math.min(right - 4, prev ? Math.max(x(it.t), prev.x + gap) : x(it.t)), k: `${it.t}-${out.length}` });
  }
  // pushed past the right edge: pull back from the end so the newest stays in view
  for (let i = out.length - 2; i >= 0; i--) if (out[i + 1].x - out[i].x < gap) out[i].x = out[i + 1].x - gap;
  return out;
}

/** The 12-hour graph: simple-mode home and the share link. */
export function BigGraph({ aspect, s, now, unit, low, high, band, alarmHigh, shots, meals, treats, pricks, at, span = 12 }: { span?: number; at?: number | null; treats: number[]; pricks: number[]; aspect: number; s: Series; now: number; unit: 'mmol' | 'mgdl'; low: number; high: number; band: [number, number]; alarmHigh: number; shots: { t: number; u: number; type: 'rapid' | 'long' }[]; meals: number[] }) {
  const W = 340, PL = 6, PR = 30, PT = 30, HH = Math.max(180, Math.round(W * aspect)), PH = HH - PT - 64;
  const t0 = now - span * H; // hours shown (12 at home)
  const top = unit === 'mmol' ? 21 * 18.016 : 350, bottom = unit === 'mmol' ? 3 * 18.016 : 50;
  const ticks = unit === 'mmol' ? [3, 6, 9, 12, 15, 18, 21].map((v) => v * 18.016) : [50, 100, 150, 200, 250, 300, 350];
  const x = (t: number) => PL + ((t - t0) / (span * H)) * (W - PL - PR);
  const y = (v: number) => PT + PH - ((Math.min(Math.max(v, bottom), top) - bottom) / (top - bottom)) * PH;
  // like Libre's graph: one point per 15 minutes (their average) and the newest reading, joined by a smooth curve
  // that never overshoots the real values; a gap of more than 20 minutes stays a gap
  let lastV: number | null = null, lastT = 0;
  const pts: { t: number; v: number }[] = [];
  let bucket = -1, sum = 0, n = 0, bt = 0;
  const flush = () => { if (n) pts.push({ t: bt / n, v: sum / n }); sum = 0; n = 0; bt = 0; };
  for (let i = 0; i < s.t.length; i++) {
    const t = s.t[i]; if (t < t0 || t > now + 60000) continue;
    const b = Math.floor(t / (15 * 60000));
    if (b !== bucket) { flush(); bucket = b; }
    sum += s.v[i]; bt += t; n++; lastV = s.v[i]; lastT = t;
  }
  flush();
  if (lastV !== null && pts.length) pts[pts.length - 1] = { t: lastT, v: lastV };
  const d = smoothPath(pts.map((p) => ({ x: x(p.t), y: y(p.v), t: p.t })), 20 * 60000);
  const dot = lastV === null ? '#64748b' : lastV < low ? '#c62f3a' : lastV > high ? '#c27a00' : '#2f8f55'; // the newest reading drawn, same as the box
  const step = span <= 4 ? 1 : 3; const first = Math.ceil(t0 / (step * H)) * step * H; const hours = [0, 1, 2, 3, 4].map((k) => first + k * step * H).filter((h) => h <= now);
  // touch the graph to read it, like Libre: a thin line at that time, a dot on the curve, the value above and the time below
  const nearest = (tt: number) => {
    if (!pts.length) return null;
    let best = pts[0]; for (const p of pts) if (Math.abs(p.t - tt) < Math.abs(best.t - tt)) best = p;
    return Math.abs(best.t - tt) <= 30 * 60000 ? best : null;
  };
  // opened from a "Rawan added …" push: start on the time of that entry
  const [pick, setPick] = useState<{ t: number; v: number } | null>(() => (at && at >= t0 ? nearest(at) : null));
  const svgRef = useRef<SVGSVGElement>(null);
  const point = (e: PE) => {
    const r = svgRef.current?.getBoundingClientRect(); if (!r || !pts.length) return;
    const k = Math.min(r.width / W, r.height / HH); // the svg keeps its aspect, centred in its box
    const vx = (e.clientX - r.left - (r.width - W * k) / 2) / k;
    setPick(nearest(t0 + ((vx - PL) / (W - PL - PR)) * span * H));
  };
  const end = () => setPick(null);
  const px = pick ? x(pick.t) : 0;
  const rowFood = PT + PH + 13, rowCare = PT + PH + 34;
  const inView = (t: number) => t >= t0 && t <= now;
  const food = lane([...meals.filter(inView).map((t) => ({ t, treat: false })), ...treats.filter(inView).map((t) => ({ t, treat: true }))], x, W - PR);
  const care = lane([...shots.filter((e) => inView(e.t)), ...pricks.filter(inView).map((t) => ({ t, u: null, type: null }))] as { t: number; u: number | null; type: 'rapid' | 'long' | null }[], x, W - PR);
  // the value sits above the plot, follows the line, and never runs off either edge
  const val = pick ? glucoseText(pick.v, unit) : '', uLabel = unit === 'mmol' ? 'mmol/L' : 'mg/dL';
  const lw = val.length * 12 + 4 + uLabel.length * 6.5;
  const lx = Math.min(Math.max(px, PL + lw / 2), W - 6 - lw / 2);
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${HH}`} className="h-full w-full" direction="ltr" role="img" aria-label={t('السكر آخر 12 ساعة')} style={{ touchAction: 'none' }}
      onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); point(e); }} onPointerMove={point} onPointerUp={end} onPointerCancel={end} onPointerLeave={end}>
      <rect x={PL} y={y(band[1])} width={W - PL - PR} height={y(band[0]) - y(band[1])} fill="#2f8f55" opacity="0.14" />
      {ticks.map((v) => <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="rgb(var(--text-3))" strokeOpacity="0.25" /><text x={W - PR + 4} y={y(v) + 4} fontSize="14" fill="#8a84a0">{glucoseText(v, unit).replace(/\.0$/, '')}</text></g>)}
      <line x1={PL} x2={W - PR} y1={y(alarmHigh)} y2={y(alarmHigh)} stroke="#f0a020" strokeWidth="2" strokeDasharray="6 5" />
      <line x1={PL} x2={W - PR} y1={y(low)} y2={y(low)} stroke="#d6303c" strokeWidth="2" strokeDasharray="6 5" />
      <path d={d} fill="none" stroke="rgb(var(--text))" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
      {lastV !== null && <circle cx={x(lastT)} cy={y(lastV)} r="8" fill={dot} stroke="#fff" strokeWidth="3" />}
      {/* under the plot, two rows that never overlap: what she ate (meals, low treatments), then insulin and finger-pricks */}
      {food.map((m) => <text key={m.k} x={m.x} y={rowFood + 5} fontSize="14" textAnchor="middle">{m.treat ? '🧃' : '🍽️'}</text>)}
      {care.map((e) => e.u == null
        ? <text key={e.k} x={e.x} y={rowCare + 5} fontSize="14" textAnchor="middle">🩸</text>
        : <g key={e.k}><circle cx={e.x} cy={rowCare} r="9" fill={PEN[e.type!]} /><text x={e.x} y={rowCare + 3.5} fontSize="10" fontWeight="700" fill="#fff" textAnchor="middle">{e.u}</text></g>)}
      {hours.map((h) => <text key={h} x={x(h)} y={HH - 3} fontSize="11" fill="#8a84a0" textAnchor="middle" opacity={pick ? 0.25 : 1}>{clock(h)}</text>)}
      {pick && <g pointerEvents="none">
        <line x1={px} x2={px} y1={PT} y2={PT + PH} stroke="rgb(var(--text))" strokeWidth="1.5" />
        <circle cx={px} cy={y(pick.v)} r="5" fill="none" stroke="rgb(var(--text))" strokeWidth="2" />
        <text x={lx} y={PT - 8} textAnchor="middle" fill="rgb(var(--text))"><tspan fontSize="21" fontWeight="800">{val}</tspan><tspan fontSize="11" fill="#8a84a0" dx="4">{uLabel}</tspan></text>
        <text x={Math.min(Math.max(px, PL + 24), W - PR - 10)} y={HH - 2} fontSize="12" fontWeight="700" fill="rgb(var(--text))" textAnchor="middle">{clock(pick.t)}</text>
      </g>}
    </svg>
  );
}
