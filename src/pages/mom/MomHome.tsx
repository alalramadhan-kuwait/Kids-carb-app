// Mom mode home: how Layan is now (big coloured box like LibreLinkUp), a large simple 12-hour graph, the last
// injections in pen colours with the doctor's 2-hour countdown, the meal in progress, and three big buttons.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as PE } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { useComparisons } from '../../lib/fingerprick';
import { nightOf } from '../../lib/schedule';
import { formatGlucose } from '../../lib/glucose';
import { useGlucose } from '../../hooks/useGlucose';
import { fetchGraphSeries } from '../../engine/useSeries';
import { mergeSeries, type Series } from '../../engine/series';
import { levelFromLibre, trendFrom } from '../../engine/trend';
import { effectiveRange } from '../../lib/glucose';
import { bigGraphScale, curvePoints, layanFace, moodOf, nextRapidAllowed, type LayanFace, type Mood } from '../../engine/mom';
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
const MOOD_DARK: Record<Mood, string> = { ok: '#1F7A4D', falling: '#9A6206', high: '#9A6206', low: '#B02A3A', stale: '#46536A' };
const MOOD: Record<Mood, { bg: string; word: string; todo: string }> = {
  ok: { bg: '#2f8f55', word: 'زين', todo: 'ما يحتاج شي الحين' }, // i18n-ok
  falling: { bg: '#c27a00', word: 'قاعد ينزل', todo: 'انتبهي وافحصيها' }, // i18n-ok
  high: { bg: '#c27a00', word: 'مرتفع', todo: 'شوفي خطة الدكتور' }, // i18n-ok
  low: { bg: '#c62f3a', word: 'نازل', todo: 'عطيها عصير الحين' }, // i18n-ok
  stale: { bg: '#64748b', word: 'ما في قراءة جديدة', todo: 'افحصيها بالإصبع' }, // i18n-ok
}; // i18n: translated where shown

export function MomHome() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const focusAt = Number(sp.get('at')) || null; // a tapped "Rawan added …" push, or «عرض في الرسم» on a meal in the log
  const fromLog = sp.get('from') === 'log';
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
  const [hours, setHours] = useState(fromLog ? 12 : 6), [picking, setPicking] = useState(false); // from a meal: 6 h before and after it
  const dark = useIsDark();
  const [recent, setRecent] = useState<Series | null>(null);
  useEffect(() => {
    const load = () => { setNow(Date.now()); void fetchGraphSeries(Date.now() - 24 * H, Date.now() + 60000).then(setRecent).catch(() => undefined); };
    load(); const id = setInterval(load, 60000); return () => clearInterval(id);
  }, []);
  // older days, one at a time, when the graph is swiped back near the oldest loaded reading (at most 14 days back)
  const [older, setOlder] = useState<{ from: number; s: Series } | null>(null);
  const loadingOlder = useRef(false);
  const loadOlder = () => {
    if (loadingOlder.current) return;
    const to = older?.from ?? now - 24 * H; if (to <= now - 14 * 24 * H) return;
    loadingOlder.current = true;
    void fetchGraphSeries(to - 24 * H, to).then((o) => setOlder((p) => ({ from: to - 24 * H, s: p ? mergeSeries(o, p.s.t, p.s.v) : o })))
      .catch(() => undefined).finally(() => { loadingOlder.current = false; });
  };
  // opened at an older meal: load from 13 hours before it in one go (swiping back loads a day at a time)
  useEffect(() => {
    if (!focusAt || focusAt > Date.now() - 22 * H) return;
    const from = focusAt - 13 * H, to = Date.now() - 24 * H;
    void fetchGraphSeries(from, to).then((o) => setOlder({ from, s: o })).catch(() => undefined);
  }, [focusAt]);
  const series = useMemo(() => (recent && older ? mergeSeries(older.s, recent.t, recent.v) : recent), [recent, older]);
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
      <div className="relative flex shrink-0 overflow-hidden rounded-3xl" style={{ color: '#fff', background: dark ? MOOD_DARK[mood] : m.bg }}>
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

      <div className="relative flex max-h-[50dvh] min-h-[120px] flex-1 flex-col rounded-3xl bg-white px-1 pt-1 shadow-[0_1px_3px_rgba(40,30,80,0.06)]">
        <button onClick={() => setFull(true)} aria-label={t('كبّري الرسم')} className="absolute left-0 top-0 z-10 grid h-[44px] w-[44px] place-items-center">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-[15px] text-slate-600">⤢</span>
        </button>
        {!picking && <div role="radiogroup" aria-label={t('المدة')} dir="ltr" className="absolute left-[46px] top-[7px] z-10 flex rounded-full bg-slate-100/90 p-[3px] text-[12px] font-bold text-slate-500">
          {[3, 6, 12, 24].map((h) => <button key={h} role="radio" aria-checked={hours === h} onClick={() => setHours(h)} className={cx('h-[26px] min-w-[34px] rounded-full px-2', hours === h ? (dark ? 'bg-white text-[#4AC6CA] shadow-sm' : 'bg-white text-[#17707A] shadow-sm') : '')}>{h}h</button>)}
        </div>}
        <div ref={box} className="min-h-0 flex-1">
          {merged && <BigGraph key={`${focusAt ?? 0}-${hours}`} span={hours} onPick={setPicking} onOlder={loadOlder} at={focusAt} aspect={aspect} s={merged} now={now} unit={unit} low={low} high={high} band={[range.low ?? 70, high]} alarmHigh={s.alert_high_mgdl ?? 240}
            shots={shots.map((e) => ({ t: Date.parse(e.occurred_at), u: e.insulin_units!, type: e.insulin_type === 'long' ? 'long' as const : 'rapid' as const }))}
            meals={history.filter((h) => (h.total_carbs ?? 99) >= 5).map((h) => ({ t: Date.parse(h.eaten_at), name: h.name, g: h.total_carbs }))}
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

/** A monotone cubic curve (Fritsch–Carlson) through the points: smooth, and never above or below the real values
 *  between two of them. Breaks into separate pieces at the points marked `brk`: readings were missing before them. */
export function smoothPath(p: { x: number; y: number; t: number; brk?: boolean }[]): string {
  let d = '';
  const runs: typeof p[] = [];
  for (const q of p) { const r = runs[runs.length - 1]; if (r && !q.brk) r.push(q); else runs.push([q]); }
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

/** The graph: simple-mode home (6 h by default, swipe for older hours), full screen and the share link. */
/** "Sun 12 Oct" / "الأحد، 12 أكتوبر" */
const shortDate = (ms: number) => new Date(ms).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const dayNo = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000; };
/** the day of a reading on the graph, so it is never read against the wrong day: today, yesterday and its date, or its date */
const graphDay = (ms: number, now: number) => { const d = dayNo(now) - dayNo(ms); return d === 0 ? t('اليوم') : d === 1 ? `${t('أمس')} · ${shortDate(ms)}` : shortDate(ms); };

type GPal = { curve: string; band: string; latest: string; meal: string; ins: string; insText: string; prick: string; high: string; low: string; highText: string; lowText: string; onCurve: string; ink: string; fillA: number; fill?: boolean; w?: number };
// deep teal by day; in dark mode the same meanings in softer, lighter tones on navy. Each warning also has a shape or
// a word (▼ low, ▲ high, line patterns), never colour alone
const GPAL0: GPal = { curve: '#17707A', band: '#E6F3EC', latest: '#169A60', meal: '#EFA055', ins: '#7A62CF', insText: '#fff', prick: '#64748B', high: '#E9A23B', low: '#DC4658', highText: '#9a6410', lowText: '#b3273a', onCurve: '#fff', ink: '#1f2937', fillA: 0.16, fill: true, w: 2.4 };
const GPAL_DARK: GPal = { curve: '#4AC6CA', band: 'rgba(61,214,140,0.10)', latest: '#3DD68C', meal: '#F2A65A', ins: '#B7A6F6', insText: '#1E2638', prick: '#94A3B8', high: '#F2B44F', low: '#FF6B7A', highText: '#F5C878', lowText: '#FF9AA4', onCurve: '#10202A', ink: '#EEF2F8', fillA: 0.13, fill: true, w: 2.4 };
export const isDark = () => { const th = document.documentElement.dataset.theme; return th === 'night' || (th !== 'day' && matchMedia('(prefers-color-scheme: dark)').matches); };
/** re-renders when the appearance changes (the setting on this phone, or the phone's own light/dark mode) */
function useIsDark() {
  const [d, setD] = useState(isDark);
  useEffect(() => {
    const upd = () => setD(isDark()); const mo = new MutationObserver(upd); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', upd); upd();
    return () => { mo.disconnect(); mq.removeEventListener('change', upd); };
  }, []);
  return d;
}
const gpal = (): GPal => isDark() ? GPAL_DARK : GPAL0;

export function BigGraph({ aspect, s, now, unit, low, high, band, alarmHigh, shots, meals, treats, pricks, at, span = 6, onPick, onOlder }: { span?: number; at?: number | null; onPick?: (on: boolean) => void; onOlder?: () => void; treats: number[]; pricks: { t: number; bg: number }[]; aspect: number; s: Series; now: number; unit: 'mmol' | 'mgdl'; low: number; high: number; band: [number, number]; alarmHigh: number; shots: { t: number; u: number; type: 'rapid' | 'long' }[]; meals: { t: number; name?: string | null; g?: number | null }[] }) {
  const P = gpal(), uid = useId().replace(/:/g, ''); // ids for the clip and fill: two graphs can be on screen at once
  const W = 340, PL = 6, PR = 30, PT = 30, HH = Math.max(180, Math.round(W * aspect)), PH = HH - PT - 50;
  // the window: `span` hours ending at `endAt` (null: now, following new readings). Swiping moves it; it never jumps
  // back by itself. It stops at the oldest loaded reading and at now.
  // opened from a "Rawan added …" push for an older entry: start with that entry in the middle of the window
  const [endAt, setEndAt] = useState<number | null>(() => (at && at < now - span * H / 2 ? at + (span * H) / 2 : null));
  const first = s.t.length ? s.t[0] : now;
  // opened at an entry: it can always be reached, even with no readings around it (the graph is then empty there)
  const minEnd = Math.min(now, Math.min(first, at ? at - (span * H) / 2 : Infinity) + span * H);
  const end = endAt === null ? now : Math.min(now, Math.max(minEnd, endAt));
  const live = endAt === null;
  const t0 = end - span * H;
  // the scale: fixed steps chosen by the highest reading loaded, so it does not change while swiping (see bigGraphScale)
  let maxSeen: number | null = null;
  for (let i = 0; i < s.t.length; i++) if (s.t[i] <= now + 60000 && (maxSeen === null || s.v[i] > maxSeen)) maxSeen = s.v[i];
  for (const p of pricks) if (p.t <= now && (maxSeen === null || p.bg > maxSeen)) maxSeen = p.bg;
  const { top, bottom, ticks } = bigGraphScale(maxSeen, unit);
  const XR = W - PR - 9;
  const x = (t: number) => PL + ((t - t0) / (span * H)) * (XR - PL);
  const y = (v: number) => PT + PH - ((Math.min(Math.max(v, bottom), top) - bottom) / (top - bottom)) * PH;
  // every real reading at its own time, a little past both edges so the line runs off the edge (clipped), never invented
  const pts = curvePoints(s, t0 - 10 * 60000, end + 10 * 60000);
  const newest = s.t.length ? { t: s.t[s.t.length - 1], v: s.v[s.v.length - 1] } : null;
  const d = smoothPath(pts.map((p) => ({ x: x(p.t), y: y(p.v), t: p.t, brk: p.brk })));
  const lastV = newest?.v ?? null, lastT = newest?.t ?? 0;
  const dot = lastV === null ? '#64748b' : lastV < low ? P.low : lastV > high ? P.high : P.latest;
  // the real clock on the axis: every hour up to 6 h, every 3 h at 12 h, every 4 h at 24 h
  const step = span <= 6 ? 1 : span <= 12 ? 3 : 4;
  const firstH = Math.ceil(t0 / (step * H)) * step * H; const hours: number[] = [];
  for (let h = firstH; h <= end; h += step * H) if (x(h) > PL + 10 && x(h) < XR - 6) hours.push(h);
  const inView = (t: number) => t >= t0 && t <= end;
  const rowFood = PT + PH + 12, rowCare = PT + PH + 28;
  const food = lane([...meals.filter((m) => inView(m.t)).map((m) => ({ ...m, treat: false, kind: 'meal' as const })), ...treats.filter(inView).map((t) => ({ t, treat: true, kind: 'treat' as const }))], x, W - PR, 15);
  const care = lane(shots.filter((e) => inView(e.t)).map((e) => ({ ...e, kind: 'shot' as const })), x, W - PR, 25);
  const nearest = (tt: number) => {
    if (!pts.length) return null;
    let best = pts[0]; for (const p of pts) if (Math.abs(p.t - tt) < Math.abs(best.t - tt)) best = p;
    return Math.abs(best.t - tt) <= 10 * 60000 && inView(best.t) ? best : null; // a real reading near the finger, or nothing
  };
  const fp = prickPoints(pricks.filter((p) => inView(p.t)).sort((a, b) => a.t - b.t), s.t, s.v);
  const pickAt = (tt: number, vy = 0): Pick | null => {
    if (vy > PT + PH + 3) {
      const row = vy < (rowFood + rowCare) / 2 ? food : care; let mk: (typeof row)[number] | null = null;
      for (const m of row) if (Math.abs(m.x - x(tt)) <= 11 && (!mk || Math.abs(m.x - x(tt)) < Math.abs(mk.x - x(tt)))) mk = m;
      if (mk) { const c = nearest(mk.t); return { t: mk.t, v: c?.v ?? NaN, mark: mk as MarkT }; }
    }
    let pr: PrickPoint | null = null;
    for (const p of fp) if (Math.abs(x(p.t) - x(tt)) <= 10 && (!pr || Math.abs(p.t - tt) < Math.abs(pr.t - tt))) pr = p;
    if (pr) return { t: pr.t, v: pr.bg, prick: pr };
    return nearest(tt);
  };
  const [pick, setPickRaw] = useState<Pick | null>(null);
  const setPick = (p: Pick | null) => { setPickRaw(p); onPick?.(!!p); };
  // the entry it was opened at: its marker's details (a meal's name and carbs), else the reading then
  useEffect(() => { if (at && at >= t0 && at <= end) setPick(pickAt(at, rowFood) ?? pickAt(at)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // near the oldest loaded reading: ask for the day before
  useEffect(() => { if (onOlder && t0 - first < 2 * H) onOlder(); }, [t0, first, onOlder]);
  const svgRef = useRef<SVGSVGElement>(null);
  const toView = (cx: number, cy: number) => {
    const r = svgRef.current?.getBoundingClientRect(); if (!r) return null;
    const k = Math.min(r.width / W, r.height / HH);
    return { vx: (cx - r.left - (r.width - W * k) / 2) / k, vy: (cy - r.top - (r.height - HH * k) / 2) / k, k };
  };
  const read = (cx: number, cy: number) => { const v = toView(cx, cy); if (v) setPick(pickAt(t0 + ((v.vx - PL) / (XR - PL)) * span * H, v.vy)); };
  // one finger: a quick sideways swipe moves the window; a touch that stays (or a tap) reads the graph and the
  // reading stays until the next tap. Up-and-down is left to the page (touch-action: pan-y).
  const g = useRef<{ x: number; y: number; mode: 'wait' | 'pan' | 'read'; end0: number; timer: number } | null>(null);
  const down = (e: PE) => {
    const st = { x: e.clientX, y: e.clientY, mode: 'wait' as 'wait' | 'pan' | 'read', end0: end, timer: 0 };
    st.timer = window.setTimeout(() => { if (st.mode === 'wait') { st.mode = 'read'; (svgRef.current as Element | null)?.setPointerCapture?.(e.pointerId); read(st.x, st.y); } }, 220);
    g.current = st;
  };
  const move = (e: PE) => {
    const st = g.current; if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (st.mode === 'wait') {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { st.mode = 'pan'; clearTimeout(st.timer); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setPick(null); }
      else if (Math.abs(dy) > 8) { clearTimeout(st.timer); g.current = null; return; } // the page scrolls
    }
    if (st.mode === 'pan') {
      const v = toView(e.clientX, e.clientY); if (!v) return;
      const ms = (dx / v.k) * ((span * H) / (XR - PL));
      const e2 = st.end0 - ms;
      setEndAt(e2 >= now - 60000 ? null : Math.max(minEnd, e2));
    } else if (st.mode === 'read') read(e.clientX, e.clientY);
  };
  const up = (e: PE) => { const st = g.current; if (!st) return; clearTimeout(st.timer); if (st.mode === 'wait') read(e.clientX, e.clientY); g.current = null; };
  const cancel = () => { const st = g.current; if (st) clearTimeout(st.timer); g.current = null; };
  // the reading: one line in the strip above the plot, so it never covers the curve
  const mk = pick?.mark ?? null, pr = pick?.prick ?? null;
  const tone = pick?.mark ? '#94a3b8' : pick ? (pick.v < low ? P.low : pick.v > high ? P.high : P.latest) : P.latest;
  const warn = pick && !mk ? (pick.v < low ? ' ▼' : pick.v > high ? ' ▲' : '') : '';
  const val = !pick ? '' : mk ? (mk.kind === 'shot' ? `${mk.u} U` : mk.kind === 'meal' && mk.g ? `${Math.round(mk.g)} g` : '🧃') : glucoseText(pick.v, unit);
  const sub = !pick ? '' : mk ? `${mk.kind === 'shot' ? PEN_NAME[mk.type!] : mk.kind === 'meal' ? (mk.name ?? t('وجبة')) : t('علاج هبوط')} · ${clock(pick.t)}`
    : pr ? `${t('وخز')}${pr.libre !== null ? ` · Libre ${glucoseText(pr.libre, unit)}` : ''} · ${clock(pick.t)}` : `${unit === 'mmol' ? 'mmol/L' : 'mg/dL'} · ${graphDay(pick.t, now)} ${clock(pick.t)}`;
  const px = pick ? x(pick.t) : 0, py = pick && Number.isFinite(pick.v) ? y(pick.v) : PT + PH;
  const midnights: number[] = [];
  for (let m = new Date(t0).setHours(24, 0, 0, 0); m < end; m = new Date(m).setHours(24, 0, 0, 0)) midnights.push(m);
  const delayed = live && lastV !== null && now - lastT >= 5 * 60000;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${HH}`} className="h-full w-full select-none" direction="ltr" role="img" aria-label={t('السكر')} style={{ touchAction: 'pan-y', WebkitUserSelect: 'none' }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
      <defs>
        <clipPath id={`plot${uid}`}><rect x={PL} y={PT - 8} width={XR - PL + 12} height={PH + 16} /></clipPath>
        <linearGradient id={`gfill${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={P.curve} stopOpacity={P.fillA} /><stop offset="1" stopColor={P.curve} stopOpacity="0" /></linearGradient>
      </defs>
      <rect x={PL} y={y(band[1])} width={W - PL - PR} height={y(band[0]) - y(band[1])} fill={P.band} />
      {ticks.map((v) => <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="rgb(var(--text-3))" strokeOpacity="0.12" strokeWidth="0.8" /><text x={W - PR + 5} y={y(v) + 4} fontSize="12.5" fill="rgb(var(--text-3))">{glucoseText(v, unit).replace(/\.0$/, '')}</text></g>)}
      {hours.map((h) => <line key={'g' + h} x1={x(h)} x2={x(h)} y1={PT} y2={PT + PH} stroke="rgb(var(--text-3))" strokeOpacity="0.07" strokeWidth="0.8" />)}
      {alarmHigh <= top && <g><line x1={PL} x2={W - PR} y1={y(alarmHigh)} y2={y(alarmHigh)} stroke={P.high} strokeWidth="1.5" strokeDasharray="1.5 3.5" strokeLinecap="round" /><text x={PL + 2} y={y(alarmHigh) - 4} fontSize="9.5" fontWeight="700" fill={P.highText} direction="ltr">▲ {t('مرتفع')}</text></g>}
      <line x1={PL} x2={W - PR} y1={y(low)} y2={y(low)} stroke={P.low} strokeWidth="1.7" strokeDasharray="7 4" /><text x={PL + 2} y={y(low) + 12} fontSize="9.5" fontWeight="700" fill={P.lowText} direction="ltr">▼ {t('منخفض')}</text>
      {midnights.map((m) => <g key={m} pointerEvents="none"><line x1={x(m)} x2={x(m)} y1={PT} y2={PT + PH} stroke="rgb(var(--text-3))" strokeWidth="1" strokeDasharray="3 4" /><text x={x(m) + 4} y={PT + PH - 5} fontSize="10" fontWeight="700" fill="#8a84a0" direction={dir()}>{shortDate(m)}</text></g>)}
      {at && at >= t0 && at <= end && <rect x={x(at) - 1.5} y={PT} width={3} height={PH + 26} rx={1.5} fill={P.meal} opacity="0.35" pointerEvents="none" />}
      <g clipPath={`url(#plot${uid})`}>
        {P.fill && <path d={d.split('M').filter(Boolean).map((seg) => { const xs = [...seg.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)]; const a = xs[0], b = xs[xs.length - 1]; return `M${a[1]},${PT + PH}L${seg}L${b[1]},${PT + PH}Z`; }).join('')} fill={`url(#gfill${uid})`} stroke="none" />}
        <path d={d} fill="none" stroke={P.curve} strokeWidth={P.w ?? 2.6} strokeLinejoin="round" strokeLinecap="round" />
      </g>
      {/* the oldest reading loaded: the edge is marked, nothing is drawn before it */}
      {first >= t0 - 60000 && <g pointerEvents="none"><line x1={x(first)} x2={x(first)} y1={PT} y2={PT + PH} stroke="rgb(var(--text-3))" strokeOpacity="0.35" strokeDasharray="2 3" /><text x={x(first) + 5} y={PT + PH - 6} fontSize="9.5" fontWeight="600" fill="rgb(var(--text-3))" textAnchor="start" direction="ltr">{'⇤ ' + t('أقدم قراءة محمّلة')}</text></g>}
      {delayed && <g pointerEvents="none">
        <rect x={x(lastT)} y={PT} width={Math.max(0, x(now) - x(lastT))} height={PH} fill="rgb(var(--text-3))" opacity="0.04" />
        <line x1={x(now)} x2={x(now)} y1={PT} y2={PT + PH} stroke="rgb(var(--text-3))" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="2 3" />
        {!pick && <text x={x(lastT) - 6} y={PT + 12} fontSize="10" fontWeight="600" fill="rgb(var(--text-3))" textAnchor="start" direction="rtl" stroke="rgb(var(--surface))" strokeWidth="3" paintOrder="stroke">{t('الحين · آخر قراءة قبل {m} د', { m: Math.round((now - lastT) / 60000) })}</text>}
      </g>}
      {live && lastV !== null && <><circle cx={x(lastT)} cy={y(lastV)} r="10" fill={dot} opacity="0.16" /><circle cx={x(lastT)} cy={y(lastV)} r="6.5" fill={dot} stroke="rgb(var(--surface))" strokeWidth="2.5" />
        {lastV < low && <text x={x(lastT)} y={y(lastV) + 3} fontSize="8" fontWeight="900" fill="#fff" textAnchor="middle">▼</text>}{lastV > high && <text x={x(lastT)} y={y(lastV) + 3} fontSize="8" fontWeight="900" fill="#fff" textAnchor="middle">▲</text>}</>}
      {fp.map((p) => {
        const fx = x(p.t), fy = y(p.bg), ly = p.libre === null ? null : y(p.libre);
        const c = p.bg < low ? P.low : p.bg > high ? P.high : P.prick;
        return (
          <g key={p.t} pointerEvents="none">
            {ly !== null && Math.abs(ly - fy) > 7 && <line x1={fx} x2={fx} y1={ly} y2={fy} stroke={c} strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="1.5 2.5" strokeLinecap="round" />}
            <path d={`M${fx} ${fy - 7}C${fx + 1.5} ${fy - 4.5} ${fx + 4.5} ${fy - 1.5} ${fx + 4.5} ${fy + 1}A4.5 4.5 0 0 1 ${fx - 4.5} ${fy + 1}C${fx - 4.5} ${fy - 1.5} ${fx - 1.5} ${fy - 4.5} ${fx} ${fy - 7}Z`} fill={c} stroke="rgb(var(--surface))" strokeWidth="1.8" strokeLinejoin="round" />
          </g>
        );
      })}
      {[...food, ...care].filter((m) => Math.abs(m.x - x(m.t)) > 2).map((m) => <circle key={'tick' + m.k} cx={x(m.t)} cy={PT + PH + 2} r="1.6" fill="rgb(var(--text-3))" opacity="0.5" />)}
      {food.map((m) => m.treat ? <text key={m.k} x={m.x} y={rowFood + 4} fontSize="11" textAnchor="middle">🧃</text> : <g key={m.k}>
        <circle cx={m.x} cy={rowFood} r="7" fill={P.meal} stroke="rgb(var(--surface))" strokeWidth="1.5" />
        <path d={`M${m.x - 2.3} ${rowFood - 3.6}v7.2M${m.x - 3.6} ${rowFood - 3.6}v2.2a1.3 1.3 0 0 0 2.6 0v-2.2M${m.x + 2.4} ${rowFood + 3.6}v-7.2c-1.4 .6 -1.6 2.6 -1.3 4.2h1.3`} stroke="#fff" strokeWidth="1.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>)}
      {care.map((e) => { const lab = `${e.u}U`, w = lab.length * 5.6 + 9; return <g key={e.k}><rect x={e.x - w / 2} y={rowCare - 7} width={w} height={14} rx={7} fill={e.type === 'rapid' ? P.ins : 'rgb(var(--surface))'} stroke={P.ins} strokeWidth="1.4" /><text x={e.x} y={rowCare + 3.5} fontSize="9.5" fontWeight="800" fill={e.type === 'rapid' ? P.insText : P.ins} textAnchor="middle" direction="ltr">{lab}</text></g>; })}
      {hours.map((h) => <text key={h} x={x(h)} y={HH - 3} fontSize="10.5" fill="rgb(var(--text-3))" textAnchor="middle" opacity={pick ? 0.3 : 1}>{clock(h)}</text>)}
      {/* back to the newest readings: only while looking at older hours */}
      {!live && <g style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); }} onClick={() => { setEndAt(null); setPick(null); }} role="button" aria-label={t('الحين')}>
        <rect x={XR - 52} y={PT + PH - 30} width={56} height={24} rx={12} fill={P.curve} style={{ filter: 'drop-shadow(0 2px 4px rgb(0 0 0 / 0.18))' }} />
        <text x={XR - 24} y={PT + PH - 14} fontSize="11.5" fontWeight="800" fill={P.onCurve} textAnchor="middle" direction="rtl">{t('الحين')} ⇥</text>
      </g>}
      {pick && <g pointerEvents="none">
        <line x1={px} x2={px} y1={PT - 4} y2={PT + PH} stroke={P.curve} strokeOpacity="0.55" strokeWidth="1.5" />
        {Number.isFinite(pick.v) && <><circle cx={px} cy={py} r="8" fill="rgb(var(--surface))" stroke={P.curve} strokeWidth="2.5" /><circle cx={px} cy={py} r="4" fill={tone} /></>}
        {(() => { const txt = `${val}${warn}`, w = Math.min(W - 52, txt.length * 9.5 + sub.length * 5.6 + 34), l = Math.min(Math.max(px - w / 2, 44), W - 2 - w); return <>
          <rect x={l} y={2} width={w} height={24} rx={12} fill="rgb(var(--surface))" stroke={P.curve} strokeOpacity="0.35" />
          <circle cx={l + 13} cy={14} r="4.5" fill={tone} />
          <text x={l + 23} y={19} direction="ltr"><tspan fontSize="15" fontWeight="800" fill={P.ink}>{txt}</tspan><tspan dx="6" fontSize="11" fill="rgb(var(--text-2))" direction={dir()}>{sub}</tspan></text>
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
  useEffect(() => { void fetchGraphSeries(now - 24 * H, now + 60000).then(setSeries).catch(() => undefined); }, [now]);
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
          meals={history.filter((h) => (h.total_carbs ?? 99) >= 5).map((h) => ({ t: Date.parse(h.eaten_at), name: h.name, g: h.total_carbs }))}
          treats={events.filter((e) => e.kind === 'treatment' && !e.deleted_at).map((e) => Date.parse(e.occurred_at))}
          pricks={pricksOf(events)} />}
      </div>
    </div>
  );
}
const history_ = window.history;
/** the finger-pricks to draw: time and value */
export const pricksOf = (events: EventRow[]) => events.filter((e) => e.kind === 'bg_check' && !e.deleted_at && e.bg_mgdl).map((e) => ({ t: Date.parse(e.occurred_at), bg: e.bg_mgdl! }));
type MarkT = { t: number; x: number; k: string; kind: 'meal' | 'treat' | 'shot'; u?: number; type?: 'rapid' | 'long'; name?: string | null; g?: number | null };
type Pick = { t: number; v: number; prick?: PrickPoint; mark?: MarkT };
