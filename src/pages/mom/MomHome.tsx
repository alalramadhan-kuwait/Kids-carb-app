// Mom mode home: how Layan is now (big coloured box like LibreLinkUp), a large simple 12-hour graph, the last
// injections in pen colours with the doctor's 2-hour countdown, the meal in progress, and three big buttons.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as PE } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { useComparisons } from '../../lib/fingerprick';
import { nightOf } from '../../lib/schedule';
import { formatGlucose } from '../../lib/glucose';
import { useGlucose } from '../../hooks/useGlucose';
import { fetchSeries } from '../../engine/useSeries';
import { mergeSeries, type Series } from '../../engine/series';
import { levelFromLibre, trendFrom } from '../../engine/trend';
import { effectiveRange } from '../../lib/glucose';
import { bigGraphScale, layanFace, moodOf, nextRapidAllowed, type LayanFace, type Mood } from '../../engine/mom';
import { useAlerts } from '../../hooks/useAlerts';
import { usePlans } from '../../lib/plans';
import { draftOps, useSensor } from '../../lib/mom';
import { phase } from '../../engine/mealPlan';
import { cx } from '../../components/ui';
import { SameMealLink, useRecentSame } from '../../components/SameMeal';
import { dir, isEn, locale, t } from '../../i18n';
import okPng from '../../assets/layan/layan-ok.png';
import okWebp from '../../assets/layan/layan-ok.webp';
import watchingPng from '../../assets/layan/layan-watching.png';
import watchingWebp from '../../assets/layan/layan-watching.webp';
import lowPng from '../../assets/layan/layan-low.png';
import lowWebp from '../../assets/layan/layan-low.webp';
import highPng from '../../assets/layan/layan-high.png';
import highWebp from '../../assets/layan/layan-high.webp';
import noReadingPng from '../../assets/layan/layan-no-reading.png';
import noReadingWebp from '../../assets/layan/layan-no-reading.webp';
import { Big, okToReplace, PEN, PEN_NAME, PenBar, TABS_PAD, ago, clock, dayWord, glucoseText, left, sensorLeft, span } from './MomUI';
import { Icon } from '../../components/Icon';
import { LastNightLine } from '../../components/LastNightLine';
import type { EventRow, Settings } from '../../lib/types';
import { inNight, prickHint, prickPoints, sensorBias, type PrickPoint } from '../../engine/prick';

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
  // a finger-prick is compared with the sensor once its readings are in: done here, in the background, so nobody has to open a page for it
  const { rows: comparisons } = useComparisons(events, history);
  const { g } = useGlucose();
  const [now, setNow] = useState(Date.now());
  const [full, setFull] = useState(false);
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
  const alerts = useAlerts();
  const face = layanFace(mood, latest?.mg_dl ?? null, s.alert_urgent_low_mgdl ?? 54, alerts.open.some((a) => a.kind === 'predicted_low'));

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
  // a meal of the other kind replaces the one being built: asked first; kept, the plate opens as it is
  const build = (mode: 'now' | 'plan') => { if (okToReplace(mode)) draftOps.start(mode); nav('/mom/meal?from=home'); };
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

  // finger-pricks: when one is worth taking (a low that is not urgent, a fast fall at night), and how this sensor
  // reads against the finger. Words only: alerts, the box above and the dose stay as they are.
  const lastPrick = events.filter((e) => e.kind === 'bg_check' && !e.deleted_at).reduce<number | null>((m, e) => Math.max(m ?? 0, Date.parse(e.occurred_at)), null);
  const hint = prickHint({ v: latest?.mg_dl ?? null, at, rate: tr?.rate ?? null, low, urgentLow: s.alert_urgent_low_mgdl ?? 54, now, lastPrick, night: inNight(now, nightOf(s)) });
  const bias = sensorBias(comparisons ?? [], sensor?.sn ?? null);
  const big = '!min-h-[52px] !text-[18px]', small = '!min-h-[48px] !px-1 !text-[16px]';
  return (
    // one fixed screen: nothing scrolls; the graph takes whatever room is left
    <main className={cx('mx-auto flex h-[100dvh] max-w-md flex-col gap-2 overflow-hidden px-4 pt-[calc(8px+env(safe-area-inset-top))]', TABS_PAD)}>
      <div className="relative flex shrink-0 overflow-hidden rounded-3xl" style={{ color: '#fff', background: m.bg }}>
        <div className="min-w-0 flex-1 py-2.5 ps-4 pe-1">
          <div className="truncate text-[13px] leading-snug opacity-90">{t('ليان')} · {at ? ago(at, now) : ''}{sensor ? ` · 📡 ${sensorLeft(sensor.life.left)}` : ''}</div>
          <div className="mt-0.5 flex items-center gap-3">
            {latest && mood !== 'stale' && <div dir="ltr" className="flex shrink-0 items-baseline gap-1"><span className="num text-[46px] font-extrabold leading-none tracking-tight">{glucoseText(latest.mg_dl, unit)}</span><span className="text-[28px] leading-none">{level !== null ? ARROW[level] : ''}</span></div>}
            <div className="min-w-0 text-[21px] font-bold leading-tight">{t(m.word)}</div>
          </div>
          <div className="mt-1 text-[15px] leading-snug opacity-95">{t(m.todo)}</div>
        </div>
        <LayanCorner face={face} />
      </div>

      <div className="relative flex max-h-[50dvh] min-h-[120px] flex-1 flex-col rounded-3xl border border-slate-100 bg-white px-1 pt-1">
        <button onClick={() => setFull(true)} aria-label={t('كبّري الرسم')} className="absolute left-0 top-0 z-10 grid h-[44px] w-[44px] place-items-center">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-[15px] text-slate-600">⤢</span>
        </button>
        <div ref={box} className="min-h-0 flex-1">
          {merged && <BigGraph key={focusAt ?? 0} at={focusAt} aspect={aspect} s={merged} now={now} unit={unit} low={low} high={high} band={[range.low ?? 70, high]} alarmHigh={s.alert_high_mgdl ?? 240}
            shots={shots.map((e) => ({ t: Date.parse(e.occurred_at), u: e.insulin_units!, type: e.insulin_type === 'long' ? 'long' as const : 'rapid' as const }))}
            meals={history.filter((h) => (h.total_carbs ?? 99) >= 5).map((h) => Date.parse(h.eaten_at))}
            treats={events.filter((e) => e.kind === 'treatment' && !e.deleted_at).map((e) => Date.parse(e.occurred_at))}
            pricks={pricksOf(events)} />}
        </div>
      </div>

      {hint ? (
        <Link to="/mom/prick" className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-2xl bg-kbg-soft px-3 py-1.5 text-kbg">
          <span className="text-xl">🩸</span>
          <span className="min-w-0 flex-1 leading-tight"><b className="block text-[15px]">{hint === 'check_low' ? t('تأكدي بوخزة إصبع') : t('نزول سريع بالليل: تأكدي بوخزة')}</b>
            <span className="block text-[12.5px] opacity-90">{hint === 'check_low' ? t('إذا عليها أعراض عالجيها على طول') : t('أحيانًا يكون ضغط على الحساس')}</span></span><span>›</span>
        </Link>
      ) : bias && bias.gap !== 'same' ? (
        <div className="flex shrink-0 items-center gap-2 px-3 text-[13px] leading-tight text-slate-500">
          <span className="text-kbg">◆</span>
          <span>{bias.gap === 'sensor_lower' ? t('هذا الحساس يقرأ أقل من الإصبع بـ ~{v}', { v: formatGlucose(bias.mgdl, unit) }) : t('هذا الحساس يقرأ أعلى من الإصبع بـ ~{v}', { v: formatGlucose(bias.mgdl, unit) })} · {t('من {n} وخزات', { n: bias.n })}</span>
        </div>
      ) : null}
      {!hint && <LastNightLine unit={unit} />}

      <div className="shrink-0 space-y-1.5 rounded-3xl border border-slate-100 bg-white p-1.5">
        {/* the last of each pen side by side: name and units, then how long ago */}
        <div className="grid grid-cols-2 gap-1.5">
          {[lastRapid && { type: 'rapid' as const, e: lastRapid }, lastLong && { type: 'long' as const, e: lastLong }].filter(Boolean).map((x, _i, all) => x && (
            <Link key={x.type} to={`/mom/entry/${x.e.id}`} className={cx('flex min-h-[48px] items-center gap-2 rounded-2xl px-2 py-1 active:bg-slate-50', all.length === 1 && 'col-span-2')}>
              <PenBar type={x.type} small />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[16px]">{t(PEN_NAME[x.type])} <b className="num">{x.e.insulin_units}</b> {t('وحدة')}</span>
                <span className="num block truncate text-[13px] text-slate-500">{ago(Date.parse(x.e.occurred_at), now)}</span>
              </span>
            </Link>
          ))}
        </div>
        {nextAt && !lowNow && (
          <div className="flex items-start gap-2 rounded-2xl bg-near-soft px-2.5 py-1.5 text-near">
            <Icon name="clock" size={16} className="mt-0.5 shrink-0" />
            <span className="min-w-0 leading-tight"><b className="block text-[14px]">{t('لا نوفورابيد قبل الساعة {c}', { c: clock(nextAt) })}</b><span className="block text-[12.5px] opacity-90">{t('خطة الدكتور: {d} بين الجرعتين', { d: span(s.dose_gap_min ?? 120) })}</span></span>
          </div>
        )}
      </div>

      {same && <SameMealLink short to={`/mom/same/${same.target.id}`} target={same.target} matches={same.matches}
        className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-2xl bg-brand-soft px-4 py-1.5 text-[16px] font-bold text-brand" />}

      {sensor && (sensorSoon || !sensor.site) && (
        <Link to="/mom/sensor" className={cx('flex min-h-[44px] shrink-0 items-center gap-3 rounded-2xl px-4 py-1.5 text-[15px] font-bold', sensorSoon ? 'bg-over-soft text-over' : 'bg-white text-brand')}>
          <span className="text-xl">📡</span>
          <span className="flex-1">{sensorSoon ? t('الحساس ينتهي {d} {c}', { d: dayWord(sensor.life.end, now), c: clock(sensor.life.end) }) : t('الحساس بأي ذراع؟')}</span><span>›</span>
        </Link>
      )}

      {juice && (
        <Link to={`/mom/entry/${juice.id}`} className="flex min-h-[44px] shrink-0 items-center gap-3 rounded-2xl bg-near-soft px-4 py-1.5 text-near">
          <span className="text-xl">🧃</span>
          <span className="flex-1 text-[15px] font-bold">{t('عصير {c}', { c: clock(Date.parse(juice.occurred_at)) })} · {juiceDue > now ? t('افحصيها بعد {m}', { m: left(juiceDue, now) }) : t('افحصيها الحين')}</span>
        </Link>
      )}

      {/* one main button: the next step of whatever is going on (kept at the bottom when the graph leaves room) */}
      <div className="mt-auto shrink-0">
        {juice ? <Big className={big} onClick={ack}><Lbl icon="✓" text={t('فحصتها')} /></Big>
          : lowNow ? <Big tone="danger" className={big} onClick={() => nav('/mom/juice')}><Lbl icon="🧃" text={t('عطيتها عصير')} /></Big>
          : open ? <Big className={big} onClick={() => nav(open.eating_at ? `/mom/ate/${open.id}` : `/mom/given/${open.id}`)}><Lbl icon="🍽️" text={open.eating_at ? t('شكثر أكلت؟') : t('بدأت تاكل؟')} /></Big>
          : due ? <Big className={big} onClick={() => nav(`/mom/plan/${due.id}`)}><Lbl icon="💉" text={t('وقت {x}', { x: due.name })} wrap /></Big>
          : <div className="grid grid-cols-2 gap-2">
              <Big className={big} onClick={() => build('now')}><Lbl icon="🍽️" text={t('أضيفي وجبة')} /></Big>
              <Big tone="soft" className={big} onClick={() => build('plan')}><Lbl icon="📅" text={t('خططي وجبة')} /></Big>
            </div>}
      </div>
      {next && <Link to={`/mom/plan/${next.id}`} className="flex min-h-[44px] shrink-0 items-center rounded-2xl bg-white px-4 py-1.5 text-[15px]">📅 <bdi>{next.name}</bdi> · {dayWord(Date.parse(next.dose_at))} 💉 {clock(Date.parse(next.dose_at))} ›</Link>}
      <div className="grid shrink-0 grid-cols-3 gap-2">
        {lowNow || juice ? <Big tone="ghost" className={small} disabled={lowNow} onClick={() => build('now')}><Lbl icon="🍽️" text={t('وجبة')} /></Big> : <Big tone="ghost" className={small} onClick={() => nav('/mom/juice')}><Lbl icon="🧃" text={t('عصير')} /></Big>}
        <Big tone="ghost" className={small} disabled={lowNow} onClick={() => nav('/mom/shot')}><Lbl icon="💉" text={t('إبرة')} /></Big>
        <Big tone="ghost" className={small} onClick={() => nav('/mom/prick')}><Lbl icon="🩸" text={t('وخز')} /></Big>
      </div>
      {full && <GraphFull onClose={() => setFull(false)} s={s} unit={unit} low={low} high={high} band={[range.low ?? 70, high]} />}
    </main>
  );
}

/** Icon and word on one line, the icon in a fixed box so every button lines up. */
function Lbl({ icon, text, wrap }: { icon: string; text: string; wrap?: boolean }) {
  return (
    <span className={cx('flex items-center justify-center gap-1.5', !wrap && 'whitespace-nowrap')}>
      <span aria-hidden className="grid w-[1.25em] shrink-0 place-items-center leading-none">{icon}</span><span className={cx(wrap && 'line-clamp-2')}>{text}</span>
    </span>
  );
}

const FACE: Record<LayanFace, [string, string]> = {
  ok: [okWebp, okPng], watching: [watchingWebp, watchingPng], low: [lowWebp, lowPng], high: [highWebp, highPng], 'no-reading': [noReadingWebp, noReadingPng],
};
/** Layan in the card's end corner, rising from its bottom edge and looking at the number beside her (the artwork
 *  looks to its right, so in English, where the number is to her left, she is mirrored). Her own column: she never
 *  covers the text. Decoration only; hidden (null) when the urgent alarm has the screen. */
function LayanCorner({ face }: { face: LayanFace | null }) {
  useEffect(() => { for (const [w] of Object.values(FACE)) { const i = new Image(); i.src = w; } }, []); // all five ready, no flash on a change
  if (!face) return null;
  return (
    <div aria-hidden className="pointer-events-none relative w-[clamp(56px,17vw,80px)] shrink-0 self-stretch">
      <picture key={face}>
        <source srcSet={FACE[face][0]} type="image/webp" />
        <img src={FACE[face][1]} alt="" draggable={false} className="layan-in absolute inset-x-0 -bottom-2.5 w-full select-none" style={{ transform: isEn() ? 'scaleX(-1)' : undefined }} />
      </picture>
    </div>
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
/** "Sun 12 Oct" / "الأحد، 12 أكتوبر" */
const shortDate = (ms: number) => new Date(ms).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const dayNo = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; };
/** the day of a reading on the graph, so it is never read against the wrong day: today, yesterday and its date, or its date */
const graphDay = (ms: number, now: number) => { const d = dayNo(now) - dayNo(ms); return d === 0 ? t('اليوم') : d === 1 ? `${t('أمس')} · ${shortDate(ms)}` : shortDate(ms); };

export function BigGraph({ aspect, s, now, unit, low, high, band, alarmHigh, shots, meals, treats, pricks, at, span = 12 }: { span?: number; at?: number | null; treats: number[]; pricks: { t: number; bg: number }[]; aspect: number; s: Series; now: number; unit: 'mmol' | 'mgdl'; low: number; high: number; band: [number, number]; alarmHigh: number; shots: { t: number; u: number; type: 'rapid' | 'long' }[]; meals: number[] }) {
  const W = 340, PL = 6, PR = 30, PT = 26, HH = Math.max(180, Math.round(W * aspect)), PH = HH - PT - 58;
  const t0 = now - span * H; // hours shown (12 at home)
  // the scale: a few fixed steps chosen by the highest reading in these hours (see bigGraphScale)
  let maxSeen: number | null = null;
  for (let i = 0; i < s.t.length; i++) if (s.t[i] >= t0 && s.t[i] <= now + 60000 && (maxSeen === null || s.v[i] > maxSeen)) maxSeen = s.v[i];
  for (const p of pricks) if (p.t >= t0 && p.t <= now && (maxSeen === null || p.bg > maxSeen)) maxSeen = p.bg; // a prick above the line stays on the graph
  const { top, bottom, ticks } = bigGraphScale(maxSeen, unit);
  const XR = W - PR - 9; // the newest dot stays clear of the axis numbers
  const x = (t: number) => PL + ((t - t0) / (span * H)) * (XR - PL);
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
  // finger-pricks at their own value, each beside the sensor's reading at that moment (engine/prick.ts)
  const fp = prickPoints(pricks.filter((p) => p.t >= t0 && p.t <= now).sort((a, b) => a.t - b.t), s.t, s.v);
  const pickAt = (tt: number): Pick | null => {
    let pr: PrickPoint | null = null;
    for (const p of fp) if (Math.abs(x(p.t) - x(tt)) <= 10 && (!pr || Math.abs(p.t - tt) < Math.abs(pr.t - tt))) pr = p; // a finger near the diamond reads the prick
    if (pr) return { t: pr.t, v: pr.bg, prick: pr };
    return nearest(tt);
  };
  // opened from a "Rawan added …" push: start on the time of that entry
  const [pick, setPick] = useState<Pick | null>(() => (at && at >= t0 ? pickAt(at) : null));
  const svgRef = useRef<SVGSVGElement>(null);
  const point = (e: PE) => {
    const r = svgRef.current?.getBoundingClientRect(); if (!r || !pts.length) return;
    const k = Math.min(r.width / W, r.height / HH); // the svg keeps its aspect, centred in its box
    const vx = (e.clientX - r.left - (r.width - W * k) / 2) / k;
    setPick(pickAt(t0 + ((vx - PL) / (XR - PL)) * span * H));
  };
  const end = () => setPick(null);
  const px = pick ? x(pick.t) : 0;
  const rowFood = PT + PH + 12, rowCare = PT + PH + 31;
  const inView = (t: number) => t >= t0 && t <= now;
  const food = lane([...meals.filter(inView).map((t) => ({ t, treat: false })), ...treats.filter(inView).map((t) => ({ t, treat: true }))], x, W - PR);
  const care = lane(shots.filter((e) => inView(e.t)), x, W - PR);
  // the value sits above the plot, follows the line, and never runs off either edge
  // the reading: a purple bubble (the curve itself is dark) with the day, time and value, its point on the line;
  // above the plot, or under the point when the point is near the top
  const val = pick ? glucoseText(pick.v, unit) : '', uLabel = unit === 'mmol' ? 'mmol/L' : 'mg/dL';
  const tone = pick ? (pick.v < low ? '--st-low' : pick.v > high ? '--st-high' : '--st-in') : '--st-in';
  const pr = pick?.prick ?? null;
  const head = !pick ? '' : pr ? `🩸 ${t('وخز')} ${clock(pick.t)}${pr.libre !== null ? ` · Libre ${glucoseText(pr.libre, unit)}` : ''}` : `${graphDay(pick.t, now)} · ${clock(pick.t)}`;
  const l1 = useRef<SVGTextElement>(null), l2 = useRef<SVGTextElement>(null);
  const [bw, setBw] = useState(150);
  useLayoutEffect(() => {
    if (!pick) return;
    try { const w = Math.ceil(Math.max(l1.current?.getComputedTextLength() ?? 0, (l2.current?.getBBox().width ?? 0) + 17)) + 22; if (Math.abs(w - bw) > 1) setBw(w); } catch { /* not laid out yet */ }
  });
  const BH = 50, py = pick ? y(pick.v) : 0, below = py < BH + 12;
  const by = below ? py + 14 : 0;
  const bx = Math.min(Math.max(px - bw / 2, below ? 2 : 40), W - 2 - bw); // clear of the ⤢ button at the top left
  const nx = Math.min(Math.max(px, bx + 12), bx + bw - 12);
  // midnight: a dashed line with the new day's date, so a long view shows where one day ends
  const midnights: number[] = [];
  for (let m = new Date(t0).setHours(24, 0, 0, 0); m < now; m = new Date(m).setHours(24, 0, 0, 0)) midnights.push(m);
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${HH}`} className="h-full w-full select-none" direction="ltr" role="img" aria-label={t('السكر آخر 12 ساعة')} style={{ touchAction: 'none', WebkitUserSelect: 'none' }}
      onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); point(e); }} onPointerMove={point} onPointerUp={end} onPointerCancel={end} onPointerLeave={end}>
      <rect x={PL} y={y(band[1])} width={W - PL - PR} height={y(band[0]) - y(band[1])} fill="#2f8f55" opacity="0.14" />
      {ticks.map((v) => <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="rgb(var(--text-3))" strokeOpacity="0.25" /><text x={W - PR + 4} y={y(v) + 4} fontSize="14" fill="#8a84a0">{glucoseText(v, unit).replace(/\.0$/, '')}</text></g>)}
      {alarmHigh <= top
        ? <line x1={PL} x2={W - PR} y1={y(alarmHigh)} y2={y(alarmHigh)} stroke="#f0a020" strokeWidth="2" strokeDasharray="6 5" />
        : <text x={W - PR - 2} y={PT - 6} fontSize="12" fontWeight="700" fill="#c27a00" textAnchor="end">{glucoseText(alarmHigh, unit)} ↑</text>}
      <line x1={PL} x2={W - PR} y1={y(low)} y2={y(low)} stroke="#d6303c" strokeWidth="2" strokeDasharray="6 5" />
      {midnights.map((m) => { const mx = x(m), lab = shortDate(m), w = lab.length * 6.4 + 14, l = mx + w + 4 > W - PR ? mx - 4 - w : mx + 4; return (
        <g key={m} pointerEvents="none">
          <line x1={mx} x2={mx} y1={PT} y2={PT + PH} stroke="rgb(var(--text-3))" strokeWidth="1.2" strokeDasharray="4 4" />
          <rect x={l} y={PT + 3} width={w} height={19} rx={9.5} fill="rgb(var(--surface-2))" />
          <text x={l + w / 2} y={PT + 16.5} fontSize="11.5" fontWeight="600" fill="rgb(var(--text))" textAnchor="middle" direction={dir()}>{lab}</text>
        </g>
      ); })}
      <path d={d} fill="none" stroke="rgb(var(--text))" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
      {lastV !== null && <circle cx={x(lastT)} cy={y(lastV)} r="8" fill={dot} stroke="#fff" strokeWidth="3" />}
      {/* finger-pricks: a diamond at the finger's value, a dotted line to the sensor's reading then, and the value */}
      {fp.map((p) => {
        const fx = x(p.t), fy = y(p.bg), ly = p.libre === null ? null : y(p.libre), up = fy > PT + 22 && (ly === null || ly >= fy - 4);
        return (
          <g key={p.t} pointerEvents="none">
            {ly !== null && Math.abs(ly - fy) > 9 && <line x1={fx} x2={fx} y1={ly} y2={fy} stroke="rgb(var(--k-bg))" strokeWidth="2.5" strokeDasharray="2 4" strokeLinecap="round" />}
            {ly !== null && <circle cx={fx} cy={ly} r="4" fill="rgb(var(--text))" stroke="rgb(var(--surface))" strokeWidth="2" />}
            <path d={`M${fx} ${fy - 9}L${fx + 9} ${fy}L${fx} ${fy + 9}L${fx - 9} ${fy}Z`} fill="rgb(var(--k-bg))" stroke="rgb(var(--surface))" strokeWidth="2.5" strokeLinejoin="round" />
            <text x={fx} y={up ? fy - 13 : fy + 23} fontSize="13" fontWeight="800" fill="rgb(var(--k-bg))" textAnchor="middle" stroke="rgb(var(--surface))" strokeWidth="3.5" paintOrder="stroke">{glucoseText(p.bg, unit)}</text>
          </g>
        );
      })}
      {/* under the plot, two rows that never overlap: what she ate (meals, low treatments), then insulin */}
      {food.map((m) => <text key={m.k} x={m.x} y={rowFood + 5} fontSize="14" textAnchor="middle">{m.treat ? '🧃' : '🍽️'}</text>)}
      {care.map((e) => <g key={e.k}><circle cx={e.x} cy={rowCare} r="9" fill={PEN[e.type]} /><text x={e.x} y={rowCare + 3.5} fontSize="10" fontWeight="700" fill="#fff" textAnchor="middle">{e.u}</text></g>)}
      {hours.map((h) => <text key={h} x={x(h)} y={HH - 3} fontSize="11" fill="#8a84a0" textAnchor="middle" opacity={pick ? 0.25 : 1}>{clock(h)}</text>)}
      {pick && <g pointerEvents="none">
        <line x1={px} x2={px} y1={below ? py : BH} y2={PT + PH} stroke="rgb(var(--primary-strong))" strokeWidth="3" />
        <circle cx={px} cy={py} r="9" fill="rgb(var(--surface))" stroke="rgb(var(--primary-strong))" strokeWidth="3" />
        <circle cx={px} cy={py} r="5" fill={`rgb(var(${tone}))`} />
        <g style={{ filter: 'drop-shadow(0 4px 8px rgb(0 0 0 / 0.25))' }}>
          <rect x={bx} y={by} width={bw} height={BH} rx={14} fill="rgb(var(--primary-strong))" />
          <path d={below ? `M${nx - 7} ${by} L${nx} ${by - 7} L${nx + 7} ${by} Z` : `M${nx - 7} ${by + BH} L${nx} ${by + BH + 7} L${nx + 7} ${by + BH} Z`} fill="rgb(var(--primary-strong))" />
        </g>
        <text ref={l1} x={dir() === 'rtl' ? bx + bw - 11 : bx + 11} y={by + 17} fontSize="12" fontWeight="600" fill="rgb(var(--surface))" fillOpacity="0.85" textAnchor="start" direction={dir()}>{head}</text>
        <circle cx={dir() === 'rtl' ? bx + bw - 17 : bx + 17} cy={by + 34} r="6" fill={`rgb(var(${tone}))`} stroke="rgb(var(--surface))" strokeWidth="2" />
        <text ref={l2} x={dir() === 'rtl' ? bx + bw - 28 : bx + 28} y={by + 43} textAnchor={dir() === 'rtl' ? 'end' : 'start'} direction="ltr"><tspan fontSize="25" fontWeight="800" fill="rgb(var(--surface))">{val}</tspan><tspan fontSize="11.5" fill="rgb(var(--surface))" fillOpacity="0.8" dx="5">{uLabel}</tspan></text>
        {(() => { const lab = clock(pick.t), w = lab.length * 7 + 16, l = Math.min(Math.max(px - w / 2, 1), W - 1 - w); return <>
          <rect x={l} y={HH - 19} width={w} height={19} rx={9.5} fill="rgb(var(--primary-strong))" />
          <text x={l + w / 2} y={HH - 5.5} fontSize="12" fontWeight="700" fill="rgb(var(--surface))" textAnchor="middle">{lab}</text>
        </>; })()}
      </g>}
    </svg>
  );
}

/** The graph, larger: full screen (landscape where the phone allows), 3, 6, 12 or 24 hours, touch to read a value.
 *  The same graph and readings as home; Close or the phone's back button returns to home. */
function GraphFull({ onClose, s: st, unit, low, high, band }: { onClose: () => void; s: Settings; unit: 'mmol' | 'mgdl'; low: number; high: number; band: [number, number] }) {
  const { events, history } = useData();
  const { g } = useGlucose();
  const [hours, setHours] = useState(12);
  const [series, setSeries] = useState<Series | null>(null);
  const [now] = useState(Date.now());
  const box = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(0.6);
  useEffect(() => { void fetchSeries(now - 24 * H, now + 60000).then(setSeries).catch(() => undefined); }, [now]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setAspect(r.height / r.width); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    history_.pushState({ graph: true }, '');
    const onPop = () => closeRef.current();
    window.addEventListener('popstate', onPop);
    const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
    el.requestFullscreen?.().then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape')).catch(() => { /* not available: the layout adapts */ });
    return () => { window.removeEventListener('popstate', onPop); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); };
  }, []);
  const merged = useMemo(() => {
    if (!series) return null;
    const lastT = series.t.length ? series.t[series.t.length - 1] : 0;
    const r = (g?.readings ?? []).filter((x) => Date.parse(x.taken_at) > lastT + 60000);
    return mergeSeries(series, r.map((x) => Date.parse(x.taken_at)), r.map((x) => x.mg_dl));
  }, [series, g]);
  return (
    <div role="dialog" aria-modal="true" aria-label={t('السكر')} className="fixed inset-0 z-[70] flex flex-col bg-white px-3 pb-[calc(8px+env(safe-area-inset-bottom))] pt-[calc(8px+env(safe-area-inset-top))]">
      <div className="flex shrink-0 items-center gap-2 pb-2">
        <div className="flex gap-1" role="radiogroup" aria-label={t('المدة')}>
          {[3, 6, 12, 24].map((h) => (
            <button key={h} role="radio" aria-checked={hours === h} onClick={() => setHours(h)} className={cx('min-h-[44px] min-w-[52px] rounded-full px-3 text-[15px] font-bold', hours === h ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600')}>{t('{h} س', { h })}</button>
          ))}
        </div>
        <button onClick={() => history_.back()} className="ms-auto min-h-[44px] rounded-full bg-slate-900 px-4 text-[16px] font-bold text-white">✕ {t('إغلاق')}</button>
      </div>
      <div ref={box} className="min-h-0 flex-1">
        {merged && <BigGraph key={hours} span={hours} aspect={aspect} s={merged} now={now} unit={unit} low={low} high={high} band={band} alarmHigh={st.alert_high_mgdl ?? 240}
          shots={events.filter((e) => e.kind === 'insulin' && !e.deleted_at && e.insulin_units).map((e) => ({ t: Date.parse(e.occurred_at), u: e.insulin_units!, type: e.insulin_type === 'long' ? 'long' as const : 'rapid' as const }))}
          meals={history.filter((h) => (h.total_carbs ?? 99) >= 5).map((h) => Date.parse(h.eaten_at))}
          treats={events.filter((e) => e.kind === 'treatment' && !e.deleted_at).map((e) => Date.parse(e.occurred_at))}
          pricks={pricksOf(events)} />}
      </div>
    </div>
  );
}
const history_ = window.history;
/** the finger-pricks to draw: time and value */
export const pricksOf = (events: EventRow[]) => events.filter((e) => e.kind === 'bg_check' && !e.deleted_at && e.bg_mgdl).map((e) => ({ t: Date.parse(e.occurred_at), bg: e.bg_mgdl! }));
type Pick = { t: number; v: number; prick?: PrickPoint };
