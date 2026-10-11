// Alert state machine (GLUCOSE_PLAN section 6), pure so it can be tested. Runs on the server every minute.
// Thresholds come from the parents. Very low, Low and No reading are protected: they cannot be switched off, and if a
// threshold is ever missing the standard one (54 / 70 mg/dL) applies. Every other alert has its own switch.
// One glucose episode is ONE alert: "low expected", "low" and "very low" are levels of the same row, which moves up
// (and is re-announced) when it gets worse and goes quiet when it recovers. Messages state facts only: never a dose,
// never grams to give.

export type AlertKind = 'urgent_low' | 'low' | 'predicted_low' | 'high' | 'no_data' | 'rapid_fall' | 'rapid_rise';
export type AlertState = 'pending' | 'active' | 'acknowledged';
export type Profile = 'day' | 'night' | 'school';
export const ALERT_KINDS: AlertKind[] = ['urgent_low', 'low', 'predicted_low', 'high', 'no_data', 'rapid_fall', 'rapid_rise'];

export interface AlertCfg {
  urgentLow: number | null; low: number | null; high: number | null; // mg/dL (day profile)
  lowDelay: number; highDelay: number; noDataMin: number; renotify: number; highRenotify: number; // minutes
  rapidRate?: number | null;   // mg/dL per minute, both directions (older setting); null = rapid alerts off
  fallRate?: number | null;    // mg/dL per minute for falling fast; overrides rapidRate when set
  riseRate?: number | null;    // mg/dL per minute for rising fast; overrides rapidRate when set
  predictLowMin?: number | null; // "low expected": warn when the current fall would reach the low limit within this many minutes
  highOn?: boolean; predictOn?: boolean; fallOn?: boolean; riseOn?: boolean; // the switches (high and low expected default on; the two fast alerts off)
  escalateMin?: number;        // minutes without "I'm on it" before the backup parent is told
  night?: { start: string; end: string; low: number | null; high: number | null; highSilent: boolean } | null;
  school?: { days: number[]; start: string; end: string; low: number | null; high: number | null } | null;
}
export interface OpenAlert {
  id: string; kind: AlertKind; state: AlertState; started_at: string; active_at: string | null;
  last_notified_at: string | null; snoozed_until: string | null; clear_since: string | null;
  value_mgdl: number | null; worst_mgdl: number | null; escalated_at?: string | null;
  acknowledged_at?: string | null;
  /** the level (kind) and glucose when someone said "I'm on it": later reminders are judged against these */
  ack_kind?: AlertKind | null; ack_value?: number | null;
  /** when the current level began (an episode that gets worse restarts the "no one answered" timer) */
  level_at?: string | null;
  progress?: { k: AlertKind; at: string }[] | null;
  eta_min?: number | null;
}
/** Alerts that ended in the last hour: the cooldown looks at them. */
export interface RecentAlert { id?: string; kind: AlertKind; started_at: string; resolved_at: string | null; progress?: { k: AlertKind; at: string }[] | null; worst_mgdl?: number | null }
export interface Reading { taken_at: string; mg_dl: number; trend: number | null }
export type Notify = 'alert' | 'repeat' | 'resolved' | 'escalate';
export interface Step {
  kind: AlertKind;
  op: 'create' | 'update' | 'delete' | 'resolve';
  id?: string;
  patch: Record<string, unknown>;
  notify?: Notify;
  silent?: boolean; // recorded but not pushed (e.g. high during a silent night)
}

const MIN = 60000;
export const FRESH_MIN = 15;
const GAP = 20 * MIN;
const HOLD: Record<AlertKind, number> = { urgent_low: 10, low: 15, predicted_low: 5, high: 15, no_data: 0, rapid_fall: 5, rapid_rise: 5 }; // minutes clear before resolving
const iso = (t: number) => new Date(t).toISOString();
/** When anyone last touched an alert: answered it or it last sounded. */
const lastTouch = (a: { acknowledged_at?: string | null; last_notified_at?: string | null; started_at: string }) =>
  Math.max(Date.parse(a.acknowledged_at ?? '') || 0, Date.parse(a.last_notified_at ?? '') || 0, Date.parse(a.started_at) || 0);
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

// ── profiles ──────────────────────────────────────────────────────────────────
const KW = 3 * 60 * MIN;
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
const within = (nowMin: number, start: string, end: string) => {
  const a = toMin(start), b = toMin(end);
  return a <= b ? nowMin >= a && nowMin < b : nowMin >= a || nowMin < b; // overnight windows wrap midnight
};
/** Which profile applies now (Kuwait time). Night wins over school. */
export function profileAt(now: number, cfg: AlertCfg): Profile {
  const k = new Date(now + KW), nowMin = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (cfg.night && within(nowMin, cfg.night.start, cfg.night.end)) return 'night';
  if (cfg.school && cfg.school.days.includes(k.getUTCDay()) && within(nowMin, cfg.school.start, cfg.school.end)) return 'school';
  return 'day';
}

/** The low limit in effect now (night and school may have their own). */
export function lowNow(now: number, cfg: AlertCfg): number | null {
  const p = profileAt(now, cfg);
  return p === 'night' ? cfg.night?.low ?? cfg.low : p === 'school' ? cfg.school?.low ?? cfg.low : cfg.low;
}

/**
 * "Low expected" looks ahead with a fading trend, not a straight line: each next 5 minutes keeps only FADE of the
 * last one's change. Tested on her readings (Oct 2026): the straight 20-minute line warned 66 times in 6 days and
 * two in three were false; this one, warning when she is falling and heads under the low limit + 10 within 30
 * minutes, caught one more of the 23 lows with about 40% fewer false warnings (about 22 minutes ahead).
 */
export const FADE = 0.7, LOOK_MIN = 30, LOW_MARGIN = 10;
export const fadedChange = (rate: number, minutes: number) => rate * 5 * FADE * (1 - FADE ** (minutes / 5)) / (1 - FADE);

/**
 * Least-squares slope over the 15 minutes up to the last reading (mg/dL per minute); needs ≥ 3 points over ≥ 5 min,
 * no gap. LibreLinkUp's 15-minute history points (no arrow) sit a few mg/dL off the minute readings beside them, so
 * where minute readings exist the history point within 2 minutes is left out (as the app's own trend does).
 */
export function rate15(all: Reading[]): number | null {
  const marked = all.filter((r) => r.trend !== null).map((r) => Date.parse(r.taken_at));
  const readings = all.filter((r) => r.trend !== null || !marked.some((m) => Math.abs(m - Date.parse(r.taken_at)) <= 2 * MIN));
  if (readings.length < 3) return null;
  const last = Date.parse(readings[readings.length - 1].taken_at);
  const pts: [number, number][] = [];
  for (let i = readings.length - 1; i >= 0; i--) {
    const t = Date.parse(readings[i].taken_at);
    if (last - t > 15 * MIN) break;
    if (pts.length && pts[pts.length - 1][0] - t > GAP) break;
    pts.push([t, readings[i].mg_dl]);
  }
  if (pts.length < 3 || pts[0][0] - pts[pts.length - 1][0] < 5 * MIN) return null;
  const mt = pts.reduce((s, p) => s + p[0], 0) / pts.length, mv = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let num = 0, den = 0;
  for (const [t, v] of pts) { const dt = (t - mt) / MIN; num += dt * (v - mv); den += dt * dt; }
  return den ? num / den : null;
}

// ── is she really about to go low? ─────────────────────────────────────────────────────────────────
/**
 * "Low expected" has to mean it: credible evidence that she will cross her LOW limit soon, from minute readings only
 * (the 15-minute history points are skipped). All of these must hold, on the readings as they are now:
 *  - enough clean points: at least `points` in the last `win` minutes, no gap over 3 minutes;
 *  - the fall is steady (the 8-minute line fits: R² ≥ minR2) and steep enough, over the last `win` and the last
 *    `short` minutes;
 *  - it is still happening: the short slope is at least `flat` of the long one and the newest reading is no higher
 *    than the one two minutes before (a flattening or a bounce cancels it at once);
 *  - Libre's own arrow is not "steady" or up (so this never contradicts the glucose card next to it);
 *  - the fading forecast from the LESS steep of the two slopes reaches the low limit within `look` minutes.
 */
export const FC = { win: 10, short: 4, points: 6, minSlope: 0.6, minShort: 0.3, flat: 0.4, minR2: 0.5, fade: 0.8, arrow: 'soft' as 'strict' | 'soft' | 'off', sparseWin: 15, sparseSlope: 0.6 };
export interface Forecast { ok: boolean; eta: number | null; slope: number; short: number; r2: number; now: number }
const fadeBy = (rate: number, minutes: number, fade: number) => rate * 5 * fade * (1 - fade ** (minutes / 5)) / (1 - fade);
function lsq(pts: [number, number][]): { slope: number; r2: number } | null {
  if (pts.length < 3) return null;
  const mt = pts.reduce((a, p) => a + p[0], 0) / pts.length, mv = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let num = 0, den = 0, tot = 0;
  for (const [t, v] of pts) { const dt = (t - mt) / MIN; num += dt * (v - mv); den += dt * dt; tot += (v - mv) ** 2; }
  if (!den) return null;
  const slope = num / den;
  return { slope, r2: tot ? (slope * slope * den) / tot : 1 };
}
/** Minute readings (those with an arrow) ending at the newest one, going back `win` minutes without a gap over 3. */
function recentMinutes(all: Reading[], win: number): [number, number][] {
  const m = all.filter((r) => r.trend !== null);
  if (!m.length) return [];
  const last = Date.parse(m[m.length - 1].taken_at), pts: [number, number][] = [];
  for (let i = m.length - 1; i >= 0; i--) {
    const t = Date.parse(m[i].taken_at);
    if (last - t > win * MIN) break;
    if (pts.length && pts[pts.length - 1][0] - t > 3 * MIN) break;
    pts.push([t, m[i].mg_dl]);
  }
  return pts.reverse();
}
/** Slope (mg/dL per minute) of the minute readings over the last `win` minutes; null without enough of them. */
export function slopeOver(all: Reading[], win: number): number | null {
  const pts = recentMinutes(all, win);
  if (pts.length < 3 || pts[pts.length - 1][0] - pts[0][0] < win * 0.5 * MIN) return null;
  return lsq(pts)?.slope ?? null;
}
/** Sparse data (a phone that lost the sensor for a while leaves only the 5–15 minute points): the same idea over
 *  the last `sparseWin` minutes, from whatever points exist (history points beside minute readings left out). */
function recentAny(all: Reading[], win: number): [number, number][] {
  const marked = all.filter((r) => r.trend !== null).map((r) => Date.parse(r.taken_at));
  const rs = all.filter((r) => r.trend !== null || !marked.some((m) => Math.abs(m - Date.parse(r.taken_at)) <= 2 * MIN));
  if (!rs.length) return [];
  const last = Date.parse(rs[rs.length - 1].taken_at), pts: [number, number][] = [];
  for (let i = rs.length - 1; i >= 0; i--) {
    const t = Date.parse(rs[i].taken_at);
    if (last - t > win * MIN) break;
    if (pts.length && pts[pts.length - 1][0] - t > 8 * MIN) break;
    pts.push([t, rs[i].mg_dl]);
  }
  return pts.reverse();
}
export function lowForecast(all: Reading[], low: number, look: number): Forecast | null {
  const newest = all[all.length - 1];
  if (!newest) return null;
  let pts = recentMinutes(all, FC.win), sparse = false;
  if (pts.length < FC.points || pts[pts.length - 1][0] - pts[0][0] < (FC.win - 2) * MIN) {
    pts = recentAny(all, FC.sparseWin); sparse = true;
    if (pts.length < 3 || pts[pts.length - 1][0] - pts[0][0] < 8 * MIN) return null;
  }
  const long = lsq(pts);
  const lastT = pts[pts.length - 1][0];
  const sh = sparse ? long : lsq(pts.filter((p) => lastT - p[0] <= FC.short * MIN));
  if (!long || !sh) return null;
  const v = pts[pts.length - 1][1];
  const before = sparse ? pts[pts.length - 2][1] : pts.find((p) => lastT - p[0] <= 2 * MIN + 1000)?.[1] ?? v;
  const slope = Math.max(long.slope, sh.slope); // the less steep: the cautious one
  // Libre's own arrow: "steady" or up while the glucose card says so can never be a warning, unless the short fall is
  // already steep enough that the arrow is about to turn
  const arrowOk = FC.arrow === 'off' || newest.trend === null || newest.trend <= 2 || (FC.arrow === 'soft' && sh.slope <= -1);
  let eta: number | null = null;
  for (let m = 1; m <= Math.max(look, 1); m++) if (v + fadeBy(slope, m, FC.fade) <= low) { eta = m; break; }
  const steep = sparse ? long.slope <= -FC.sparseSlope : long.slope <= -FC.minSlope && sh.slope <= -FC.minShort && sh.slope <= long.slope * FC.flat;
  const ok = arrowOk && steep && long.r2 >= FC.minR2 && v <= before && v > low && eta !== null;
  return { ok, eta: ok ? eta : null, slope: long.slope, short: sh.slope, r2: long.r2, now: v };
}

// ── the engine ───────────────────────────────────────────────────────────────────────────────────────
export const COOLDOWN_MIN = 30;   // after a non-critical alert ends, the same one stays quiet this long (unless it is imminent)
export const IMMINENT_MIN = 10;   // …"imminent" = the low limit is this close in time
const DEFAULT_URGENT = 54, DEFAULT_LOW = 70;
const RANK: Partial<Record<AlertKind, number>> = { predicted_low: 1, low: 2, urgent_low: 3 };
const LEVEL: AlertKind[] = ['predicted_low', 'predicted_low', 'low', 'urgent_low'];

export function evaluate(now: number, readings: Reading[], cfg: AlertCfg, open: OpenAlert[], cgmConnected: boolean, recent: RecentAlert[] = []): Step[] {
  const steps: Step[] = [];
  const latest = readings.length ? readings[readings.length - 1] : null;
  const age = latest ? (now - Date.parse(latest.taken_at)) / MIN : Infinity;
  const fresh = age <= FRESH_MIN;
  const v = latest?.mg_dl ?? null;
  const profile = profileAt(now, cfg);
  const lowCfg = profile === 'night' ? cfg.night?.low ?? cfg.low : profile === 'school' ? cfg.school?.low ?? cfg.low : cfg.low;
  const highCfg = profile === 'night' ? cfg.night?.high ?? cfg.high : profile === 'school' ? cfg.school?.high ?? cfg.high : cfg.high;
  const U = cfg.urgentLow ?? DEFAULT_URGENT, L = lowCfg ?? DEFAULT_LOW;       // protected: always on
  const highSilent = profile === 'night' && !!cfg.night?.highSilent;
  const rate = fresh ? rate15(readings) : null;
  const RF = cfg.fallRate ?? cfg.rapidRate ?? null, RR = cfg.riseRate ?? cfg.rapidRate ?? null;
  const P = cfg.predictLowMin ?? 20;
  const predictOn = cfg.predictOn !== false;
  const fc = fresh && v !== null && predictOn ? lowForecast(readings, L, Math.max(P, 1)) : null;
  const r10 = fresh ? slopeOver(readings, 10) : null;
  const iso0 = iso(now);
  const escalateAfter = cfg.escalateMin ?? 10;
  const worstOf = (kind: AlertKind, w: number | null) => (v === null ? w : w === null ? v : kind === 'high' || kind === 'rapid_rise' ? Math.max(w, v) : Math.min(w, v));
  const coolingFor = (kind: AlertKind) => recent.some((r) => r.kind === kind && r.resolved_at && now - ms(r.resolved_at) < COOLDOWN_MIN * MIN);

  // ── the low episode: expected → low → very low is one row that moves up ──────────────────────────
  const grp = open.filter((a) => RANK[a.kind]).sort((a, b) => RANK[b.kind]! - RANK[a.kind]! || ms(a.started_at) - ms(b.started_at));
  const cur = grp[0] ?? null;
  for (const extra of grp.slice(1)) steps.push({ kind: extra.kind, op: extra.state === 'pending' ? 'delete' : 'resolve', id: extra.id, patch: { resolved_at: iso0 } }); // an older engine left two open
  const curRank = cur ? RANK[cur.kind]! : 0;
  if (fresh && v !== null) {
    const lowDelay = cfg.lowDelay;
    const then = lowDelay > 0 ? readings.find((r) => Math.abs(now - lowDelay * MIN - Date.parse(r.taken_at)) <= 1.5 * MIN) : latest;
    const cU = v <= U, cL = v <= L && (lowDelay === 0 || (!!then && then.mg_dl <= L));
    const sustU = curRank === 3 && v < U + 10, sustL = curRank >= 2 && v < L + 10;
    const cP = !!fc?.ok;
    const target = cU || sustU ? 3 : cL || sustL ? 2 : cP ? 1 : 0;
    const lvlKind = LEVEL[target];
    const upd = (patch: Record<string, unknown>, notify: Notify | undefined, id: string, kind: AlertKind) => steps.push({ kind, op: 'update', id, patch, notify });
    if (!cur) {
      // the same episode: one that ended in the last 15 minutes is reopened, not duplicated
      const back = recent.filter((r) => r.id && RANK[r.kind] && r.resolved_at && now - ms(r.resolved_at) <= 15 * MIN).sort((a, b) => ms(b.resolved_at) - ms(a.resolved_at))[0] ?? null;
      const reopen = (k: AlertKind, eta: number | null) => steps.push({ kind: k, op: 'update', id: back!.id, notify: 'alert', patch: { kind: k, state: 'active', resolved_at: null, clear_since: null, snoozed_until: null, ack_kind: null, escalated_at: null,
        level_at: iso0, last_notified_at: iso0, value_mgdl: v, worst_mgdl: worstOf(k, back!.worst_mgdl ?? null), eta_min: eta, progress: [...(back!.progress ?? [{ k: back!.kind, at: back!.started_at }]), { k, at: iso0 }] } });
      if (target >= 2) {
        if (back) reopen(lvlKind, null);
        else steps.push({ kind: lvlKind, op: 'create', patch: { state: 'active', profile, started_at: iso0, active_at: iso0, level_at: iso0, last_notified_at: iso0, value_mgdl: v, worst_mgdl: v, progress: [{ k: lvlKind, at: iso0 }] }, notify: 'alert' });
      } else if (target === 1 && !(coolingFor('predicted_low') && (fc!.eta ?? 99) > IMMINENT_MIN)) {
        if (back) reopen('predicted_low', fc!.eta);
        else steps.push({ kind: 'predicted_low', op: 'create', patch: { state: 'pending', profile, started_at: iso0, value_mgdl: v, worst_mgdl: v, eta_min: fc!.eta } });
      }
    } else if (cur.state === 'pending') {
      if (target === 0) steps.push({ kind: cur.kind, op: 'delete', id: cur.id, patch: {} });
      else if (target >= 2 || now - ms(cur.started_at) >= 1 * MIN)
        upd({ kind: lvlKind, state: 'active', active_at: iso0, level_at: iso0, last_notified_at: iso0, value_mgdl: v, worst_mgdl: worstOf(lvlKind, cur.worst_mgdl), eta_min: target === 1 ? fc!.eta : null, progress: [{ k: lvlKind, at: iso0 }] }, 'alert', cur.id, lvlKind);
      else upd({ value_mgdl: v, worst_mgdl: worstOf(cur.kind, cur.worst_mgdl), eta_min: fc?.eta ?? null }, undefined, cur.id, cur.kind);
    } else if (target > curRank) {
      // worse: the same alert moves up, is unanswered again, and is announced (the cooldown never applies to this)
      upd({ kind: lvlKind, state: 'active', level_at: iso0, last_notified_at: iso0, clear_since: null, snoozed_until: null, ack_kind: null, escalated_at: null, eta_min: null,
        value_mgdl: v, worst_mgdl: worstOf(lvlKind, cur.worst_mgdl), progress: [...(cur.progress ?? [{ k: cur.kind, at: cur.active_at ?? cur.started_at }]), { k: lvlKind, at: iso0 }] }, 'alert', cur.id, lvlKind);
    } else if (target === 0 || (target < 2 && curRank >= 2)) {
      if (curRank === 1) steps.push({ kind: cur.kind, op: 'resolve', id: cur.id, patch: { resolved_at: iso0, value_mgdl: v, eta_min: null } }); // the prediction no longer holds: gone at once
      else {
        const since = cur.clear_since ? ms(cur.clear_since) : now;
        if (now - since >= (curRank === 3 ? 10 : 15) * MIN) steps.push({ kind: cur.kind, op: 'resolve', id: cur.id, patch: { resolved_at: iso0, value_mgdl: v }, notify: 'resolved' });
        else upd({ clear_since: iso(since), value_mgdl: v, worst_mgdl: worstOf(cur.kind, cur.worst_mgdl) }, undefined, cur.id, cur.kind);
      }
    } else {
      const down = target < curRank; // very low → low: calmer, same alert
      const patch: Record<string, unknown> = { clear_since: null, value_mgdl: v, worst_mgdl: worstOf(cur.kind, cur.worst_mgdl), eta_min: target === 1 ? fc?.eta ?? null : null };
      if (down) patch.kind = lvlKind;
      let notify: Notify | undefined;
      const kind = down ? lvlKind : cur.kind;
      if (cur.state === 'acknowledged') {
        // "I'm on it" is respected: quiet while she recovers, loud again if she gets worse, a reminder if it drags on
        const el = (now - lastTouch(cur)) / MIN;
        const rising = r10 !== null && r10 >= 0.3, falling = r10 !== null && r10 <= -0.5;
        const inLevel = curRank === 3 ? v <= U : curRank === 2 ? v <= L : true; // recovered above the limit: nothing to remind about
        const worse = curRank >= 2 && falling && v < (cur.ack_value ?? Infinity) && el >= 5;
        const persist = curRank === 3 ? (rising ? 30 : 15) : curRank === 2 ? (rising ? 60 : 30) : 60;
        if (inLevel && (worse || el >= persist)) { Object.assign(patch, { state: 'active', last_notified_at: iso0, snoozed_until: null, level_at: iso0 }); notify = 'repeat'; }
      } else {
        const escalates = curRank >= 2;
        const after = curRank === 3 ? Math.min(escalateAfter, 5) : escalateAfter;
        const renotify = curRank === 3 ? Math.min(cfg.renotify, 5) : cfg.renotify;
        const inLevel = curRank === 3 ? v <= U : v <= L;
        if (escalates && inLevel && !cur.escalated_at && now - ms(cur.level_at ?? cur.active_at ?? cur.started_at) >= after * MIN) { Object.assign(patch, { escalated_at: iso0, last_notified_at: iso0 }); notify = 'escalate'; }
        else if (escalates && inLevel && now - ms(cur.last_notified_at ?? cur.active_at ?? cur.started_at) >= renotify * MIN) { patch.last_notified_at = iso0; notify = 'repeat'; }
      }
      steps.push({ kind, op: 'update', id: cur.id, patch, notify });
    }
  }

  // ── high, no reading and the two fast alerts: each its own alert ─────────────────────────────────
  const byKind = new Map(open.map((a) => [a.kind, a]));
  for (const kind of ['high', 'no_data', 'rapid_fall', 'rapid_rise'] as AlertKind[]) {
    const a = byKind.get(kind) ?? null;
    let enabled: boolean, cond: boolean, clear: boolean, delay: number, renotify: number;
    switch (kind) {
      case 'high':
        enabled = highCfg !== null && cfg.highOn !== false; delay = cfg.highDelay; renotify = cfg.highRenotify;
        cond = fresh && v! >= highCfg!; clear = fresh && v! <= highCfg! - 20; break;
      case 'rapid_fall':
        enabled = cfg.fallOn === true && RF !== null && !cur; delay = 2; renotify = 24 * 60;
        cond = rate !== null && rate <= -RF!; clear = rate !== null && rate > -RF! * 0.6; break;
      case 'rapid_rise':
        enabled = cfg.riseOn === true && RR !== null; delay = 2; renotify = 24 * 60;
        cond = rate !== null && rate >= RR!; clear = rate !== null && rate < RR! * 0.6; break;
      default:
        enabled = cgmConnected; delay = 0; renotify = Math.max(cfg.renotify, 15);
        cond = age > cfg.noDataMin; clear = !cond;
    }
    const silent = kind === 'high' && highSilent;
    const value = kind === 'no_data' ? null : fresh ? v : a?.value_mgdl ?? null;
    const hold = kind === 'high' ? 15 : kind === 'no_data' ? 0 : 5;

    if (!a) {
      if (!enabled || !cond) continue;
      if (kind !== 'no_data' && kind !== 'high' && coolingFor(kind)) continue;
      if (delay === 0) steps.push({ kind, op: 'create', patch: { state: 'active', profile, started_at: iso0, active_at: iso0, last_notified_at: iso0, level_at: iso0, value_mgdl: value, worst_mgdl: value }, notify: 'alert', silent });
      else steps.push({ kind, op: 'create', patch: { state: 'pending', profile, started_at: iso0, value_mgdl: value, worst_mgdl: value } });
      continue;
    }
    if (!enabled) { steps.push({ kind, op: a.state === 'pending' ? 'delete' : 'resolve', id: a.id, patch: { resolved_at: iso0 } }); continue; }
    if (a.state === 'pending') {
      if (!cond) { steps.push({ kind, op: 'delete', id: a.id, patch: {} }); continue; }
      if (now - ms(a.started_at) >= delay * MIN) steps.push({ kind, op: 'update', id: a.id, patch: { state: 'active', active_at: iso0, level_at: iso0, last_notified_at: iso0, value_mgdl: value, worst_mgdl: worstOf(kind, a.worst_mgdl) }, notify: 'alert', silent });
      else steps.push({ kind, op: 'update', id: a.id, patch: { value_mgdl: value, worst_mgdl: worstOf(kind, a.worst_mgdl) } });
      continue;
    }
    if (clear) {
      const since = a.clear_since ? ms(a.clear_since) : now;
      if (now - since >= hold * MIN) steps.push({ kind, op: 'resolve', id: a.id, patch: { resolved_at: iso0, value_mgdl: value }, notify: kind === 'no_data' ? 'resolved' : undefined });
      else steps.push({ kind, op: 'update', id: a.id, patch: { clear_since: iso(since), value_mgdl: value, worst_mgdl: worstOf(kind, a.worst_mgdl) } });
      continue;
    }
    const patch: Record<string, unknown> = { clear_since: null, value_mgdl: value, worst_mgdl: worstOf(kind, a.worst_mgdl) };
    let notify: Notify | undefined;
    if (a.state === 'acknowledged') {
      if (kind === 'high') {
        // answered: quiet while she comes down, a reminder if it drags on, sooner if it is still climbing
        const el = (now - lastTouch(a)) / MIN;
        const falling = r10 !== null && r10 <= -0.3, climbing = r10 !== null && r10 >= 1 && v! > (a.ack_value ?? Infinity);
        if ((climbing && el >= 20) || el >= renotify * (falling ? 2 : 1)) { Object.assign(patch, { state: 'active', last_notified_at: iso0, snoozed_until: null }); notify = 'repeat'; }
      } else if (cond && a.snoozed_until && now >= ms(a.snoozed_until)) {
        Object.assign(patch, { state: 'active', snoozed_until: null, last_notified_at: iso0 }); notify = 'repeat';
      }
    } else {
      const escalates = kind === 'no_data';
      if (escalates && !a.escalated_at && now - ms(a.active_at ?? a.started_at) >= escalateAfter * MIN) { Object.assign(patch, { escalated_at: iso0, last_notified_at: iso0 }); notify = 'escalate'; }
      else if (cond && now - ms(a.last_notified_at ?? a.active_at ?? a.started_at) >= renotify * MIN) { patch.last_notified_at = iso0; notify = 'repeat'; }
    }
    steps.push({ kind, op: 'update', id: a.id, patch, notify, silent });
  }
  return steps;
}

// ── wording ────────────────────────────────────────────────────────────────────
// Read in 1–2 seconds: the title says what is happening (and when), the first body line the glucose now with its
// direction, the second (if any) what it means or what to do. Severity leads the title: 🔴 act now, 🟠 needs
// attention, 🔵 for information, ✅ over. No names, no source, nothing about doses or grams.
export type Lang = 'ar' | 'en';
export type Severity = 'urgent' | 'warning' | 'info' | 'ok';
const MARK: Record<Severity, string> = { urgent: '🔴', warning: '🟠', info: '🔵', ok: '✅' };
export const ALERT_NAME: Record<AlertKind, string> = {
  urgent_low: 'منخفض جدًا', low: 'منخفض', predicted_low: 'انخفاض متوقع', high: 'مرتفع', no_data: 'لا توجد قراءة', rapid_fall: 'ينزل بسرعة', rapid_rise: 'يرتفع بسرعة',
};
const ALERT_NAME_EN: Record<AlertKind, string> = {
  urgent_low: 'Very low', low: 'Low', predicted_low: 'Low expected', high: 'High', no_data: 'No reading', rapid_fall: 'Falling fast', rapid_rise: 'Rising fast',
};
const ARROW: Record<number, string> = { 1: '↓', 2: '↘', 3: '→', 4: '↗', 5: '↑' };
/** Libre's arrow, else one from the last 15 minutes' rate (mg/dL per minute). */
const arrowOf = (trend: number | null, rate?: number | null) =>
  trend ? ARROW[trend] : rate == null ? '' : rate <= -2 ? '↓' : rate <= -1 ? '↘' : rate < 1 ? '→' : rate < 2 ? '↗' : '↑';
const num = (mg: number, unit: 'mgdl' | 'mmol') => (unit === 'mmol' ? (Math.round((mg / 18.016) * 10) / 10).toFixed(1) : String(Math.round(mg)));
const LRI = String.fromCharCode(0x2066), PDI = String.fromCharCode(0x2069); // keeps "5.2 ↘" together inside Arabic text
/** "الآن 5.2 ↘ ملمول/ل": the current value, never mistaken for a forecast. */
export function nowLine(mg: number, trend: number | null, unit: 'mgdl' | 'mmol', lang: Lang, rate?: number | null) {
  const a = arrowOf(trend, rate), v = `${LRI}${num(mg, unit)}${a ? ' ' + a : ''}${PDI}`;
  return lang === 'en' ? `Now ${v} ${unit === 'mmol' ? 'mmol/L' : 'mg/dL'}` : `الآن ${v} ${unit === 'mmol' ? 'ملمول/ل' : 'ملغ/دل'}`;
}
/** Minutes in words: "5 دقائق", "20 دقيقة", "ساعة و10 دقائق" / "20 min", "1 h 10 min". */
export function dur(min: number, lang: Lang) {
  const m = Math.max(1, Math.round(min));
  if (lang === 'en') return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  const mins = (n: number) => (n === 1 ? 'دقيقة' : n === 2 ? 'دقيقتين' : n <= 10 ? `${n} دقائق` : `${n} دقيقة`);
  const hours = (n: number) => (n === 1 ? 'ساعة' : n === 2 ? 'ساعتين' : n <= 10 ? `${n} ساعات` : `${n} ساعة`);
  if (m < 60) return mins(m);
  return m % 60 ? `${hours(Math.floor(m / 60))} و${mins(m % 60)}` : hours(m / 60);
}
const sev = (kind: AlertKind, notify: Notify): Severity =>
  notify === 'resolved' ? 'ok' : notify === 'escalate' || kind === 'urgent_low' ? 'urgent' : kind === 'rapid_rise' ? 'info' : 'warning';
const join = (...lines: (string | false | null | undefined)[]) => lines.filter(Boolean).join('\n');

export interface AlertFacts {
  value: number | null; trend: number | null; unit: 'mgdl' | 'mmol'; minutes: number;
  low?: number | null;  // the low limit in effect now (mg/dL)
  rate?: number | null; // mg/dL per minute over the last 15 minutes
  ahead?: number | null; // older: the "low expected" look-ahead (minutes), when the rate cannot give a time
  eta?: number | null;   // minutes until the low limit at the current fall (only when the forecast is credible)
}
/** Minutes until the current fall, fading, reaches the low limit (within an hour); null if it levels off above it. */
export function minutesToLow(f: AlertFacts): number | null {
  if (f.value === null || f.low == null || f.rate == null || f.rate >= 0 || f.value <= f.low) return null;
  for (let m = 1; m <= 60; m++) if (f.value + fadedChange(f.rate, m) <= f.low) return m;
  return null;
}

/** Push wording, in each parent's app language (carb.members.lang). */
export function alertMessage(kind: AlertKind, notify: Notify, f: AlertFacts, lang: Lang = 'ar') {
  const en = lang === 'en', s = sev(kind, notify);
  const now = f.value !== null ? nowLine(f.value, f.trend, f.unit, lang, f.rate) : null;
  const since = f.minutes >= 1 ? dur(f.minutes, lang) : null;
  const lowTxt = f.low != null ? `${LRI}${num(f.low, f.unit)}${PDI}` : null;
  const eta = minutesToLow(f);
  const out = (title: string, ...body: (string | false | null | undefined)[]) =>
    ({ title: `${MARK[s]} ${title}`, body: join(...body), urgency: s === 'urgent' || s === 'warning' ? ('high' as const) : ('normal' as const), severity: s });

  if (notify === 'resolved') return kind === 'no_data'
    ? out(en ? 'Readings are back' : 'رجعت القراءات', now)
    : out(en ? `${ALERT_NAME_EN[kind]} is over` : kind === 'high' ? 'انتهى الارتفاع' : 'انتهى الانخفاض', now);
  if (notify === 'escalate') return kind === 'no_data'
    ? out(en ? `No one answered · no reading for ${since}` : `لم يرد أحد · لا توجد قراءة منذ ${since}`, en ? 'Check the sensor and the phone near her' : 'تأكدوا من الحساس والجوال القريب منها')
    : out(en ? `No one answered · ${ALERT_NAME_EN[kind]}${since ? ` for ${since}` : ''}` : `لم يرد أحد · ${ALERT_NAME[kind]}${since ? ` منذ ${since}` : ''}`, now, en ? 'Treat now' : 'عالجوا الآن');
  const still = notify === 'repeat';
  switch (kind) {
    case 'urgent_low':
      return out(en ? (still ? 'Still very low · treat now' : 'Very low · treat now') : still ? 'ما زال منخفضًا جدًا · عالجوا الآن' : 'منخفض جدًا · عالجوا الآن', now, since && (en ? `For ${since}` : `منذ ${since}`));
    case 'low':
      return out(en ? (still ? 'Still low' : 'Low · needs treatment') : still ? 'ما زال منخفضًا' : 'منخفض · يحتاج علاجًا', now, since && (en ? `For ${since}` : `منذ ${since}`));
    case 'predicted_low': {
      const m = Math.round(f.eta ?? eta ?? f.ahead ?? LOOK_MIN);
      return out(en ? 'Low expected' : 'انخفاض متوقع', now, lowTxt && (en ? `May reach ${lowTxt} in ~${dur(m, lang)}` : `قد يصل ${lowTxt} خلال ~${dur(m, lang)}`));
    }
    case 'high':
      return out(en ? `${still ? 'Still high' : 'High'}${since ? ` for ${since}` : ''}` : `${still ? 'ما زال مرتفعًا' : 'مرتفع'}${since ? ` منذ ${since}` : ''}`, now);
    case 'rapid_fall':
      return out(en ? 'Falling fast' : 'ينزل بسرعة', now, eta !== null && eta <= 60 && lowTxt && (en ? `May drop below ${lowTxt} in ${dur(eta, lang)}` : `قد ينزل تحت ${lowTxt} خلال ${dur(eta, lang)}`));
    case 'rapid_rise':
      return out(en ? 'Rising fast' : 'يرتفع بسرعة', now);
    default:
      return out(en ? `${still ? 'Still no' : 'No'} reading for ${since ?? dur(1, lang)}` : `${still ? 'ما زالت لا توجد قراءة' : 'لا توجد قراءة'} منذ ${since ?? dur(1, lang)}`,
        en ? 'Check the sensor and the phone near her' : 'تأكدوا من الحساس والجوال القريب منها');
  }
}

/** Another parent answered: the others know they need not act. */
export function ackMessage(kind: AlertKind, who: string | null, action: 'on_it' | 'treated', lang: Lang = 'ar') {
  const en = lang === 'en', name = who || (en ? 'A parent' : 'أحد الوالدين');
  const did = en ? (action === 'treated' ? 'treated it' : 'is on it') : action === 'treated' ? 'عالجه' : 'يتابعه';
  return { title: `${MARK.ok} ${name} ${did}`, body: en ? `${ALERT_NAME_EN[kind]} · nothing to do now` : `${ALERT_NAME[kind]} · لا حاجة لفعل شيء الآن`, urgency: 'normal' as const };
}

export const testMessage = (lang: Lang = 'ar') =>
  lang === 'en' ? { title: `${MARK.info} Test alert`, body: 'Alerts work on this phone' } : { title: `${MARK.info} تنبيه تجربة`, body: 'التنبيهات تعمل على هذا الجوال' };

/** Who is told: first alerts and repeats go to the primary parents (everyone if none is primary); escalation adds the backups. */
export function recipients(members: { user_id: string; alert_role: string }[], notify: Notify): string[] {
  const on = members.filter((m) => m.alert_role !== 'off');
  const primary = on.filter((m) => m.alert_role === 'primary');
  if (notify === 'escalate') return on.map((m) => m.user_id);
  return (primary.length ? primary : on).map((m) => m.user_id);
}

/** Kuwait time, 12-hour like the app: "7:30 م" / "7:30 PM". */
const kwClock = (ms: number, en = false) => {
  const k = new Date(ms + 3 * 3600000), h = k.getUTCHours();
  return `${LRI}${h % 12 || 12}:${String(k.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? (en ? 'AM' : 'ص') : (en ? 'PM' : 'م')}${PDI}`;
};

/** Sensor expiry reminder: when it ends, in Kuwait time, so a change can be planned outside school or sleep. */
export function sensorMessage(due: '24' | '2', endsAt: number, lang: Lang = 'ar') {
  const en = lang === 'en';
  const at = kwClock(endsAt, en);
  const title = `${MARK.info} ${en ? `Sensor ends ${due === '2' ? 'in 2 hours' : 'within a day'}` : `الحساس ينتهي ${due === '2' ? 'خلال ساعتين' : 'خلال يوم'}`}`;
  return { title, body: en ? `At ${at} · have a new sensor ready` : `الساعة ${at} · جهّزوا حساسًا جديدًا` };
}

// ── Planned meals: a push at the check (the reminder before the dose), at the eat time and at a low's recheck ──
export type PlanPush = 'check' | 'eat' | 'recheck' | 'early' | 'final';
export interface PlanRow { status: string; name: string; slot: string; dose_at: string; eat_after_min: number; remind_min: number; recheck_at: string | null; notified: Record<string, string> | null; eating_at?: string | null }
const LATE_MIN = 30; // a reminder more than this late is not sent: the moment has passed

/** The reminder a plan is due for now, if any. Each goes out once for the time it is about (moving that time sends it
 *  again), and none is sent once the moment is long past. */
export function planPushDue(p: PlanRow, now: number, review: { earlyMin: number; diaMin: number } = { earlyMin: 120, diaMin: 360 }): { kind: PlanPush; at: string } | null {
  const sent = p.notified ?? {};
  const due = (kind: PlanPush, at: number) => (now >= at && now - at <= LATE_MIN * MIN && sent[kind] !== new Date(at).toISOString() ? { kind, at: new Date(at).toISOString() } : null);
  const dose = Date.parse(p.dose_at);
  // after the meal: the early result (about 2 h) and the final review (the insulin-action time)
  if (p.status === 'eaten') {
    if (!p.eating_at) return null;
    const e = Date.parse(p.eating_at);
    return due('final', e + review.diaMin * MIN) ?? due('early', e + review.earlyMin * MIN);
  }
  if (p.status === 'dosed') return due('eat', dose + p.eat_after_min * MIN);
  if (p.status !== 'planned') return null;
  if (p.recheck_at) return due('recheck', Date.parse(p.recheck_at));
  return due('check', dose - p.remind_min * MIN);
}

const SLOT_AR: Record<string, string> = { breakfast: 'الفطور', lunch: 'الغداء', dinner: 'العشاء', snack: 'السناك' };
const SLOT_EN: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

/** Plan reminders; `g` is her glucose now, when there is a recent reading. */
export function planMessage(kind: PlanPush, p: PlanRow, lang: Lang = 'ar', g?: { mg: number; trend: number | null; unit: 'mgdl' | 'mmol' } | null) {
  const en = lang === 'en', meal = (en ? SLOT_EN : SLOT_AR)[p.slot] ?? p.name;
  const now = g ? nowLine(g.mg, g.trend, g.unit, lang) : null;
  const dose = Date.parse(p.dose_at);
  if (kind === 'check') return {
    title: `${MARK.info} ${en ? `${meal} plan · dose at ${kwClock(dose, true)}` : `خطة ${meal} · الجرعة ${kwClock(dose)}`}`,
    body: join(now, en ? 'Check her glucose and confirm the dose' : 'افحصوا السكر وأكّدوا الجرعة'),
  };
  if (kind === 'eat') return {
    title: `${MARK.info} ${en ? `Time to eat: ${meal}` : `وقت أكل ${meal}`}`,
    body: join(en ? `${dur(p.eat_after_min, lang)} since the dose` : `مرّت ${dur(p.eat_after_min, lang)} على الجرعة`, en ? 'After eating, tap “She ate”' : 'بعد الأكل اضغطوا «أكلت»'),
  };
  if (kind === 'early') return {
    title: `${MARK.info} ${en ? `Early result: ${meal}` : `النتيجة الأولية: ${meal}`}`,
    body: join(now, en ? '2 h after eating · open to see how it is going' : 'بعد ساعتين من الأكل · افتحوها لتروا كيف تسير'),
  };
  if (kind === 'final') return {
    title: `${MARK.info} ${en ? `${meal} review ready` : `مراجعة ${meal} جاهزة`}`,
    body: en ? 'Open it to see the full result and add your note' : 'افتحوها لتروا النتيجة كاملة وتكتبوا ملاحظتكم',
  };
  return {
    title: `${MARK.warning} ${en ? 'Recheck her glucose' : 'أعيدوا قياس السكر'}`,
    body: join(now, en ? `15 min since the low was treated · before the ${meal.toLowerCase()} dose` : `مرّت 15 دقيقة على علاج الانخفاض · قبل جرعة ${meal}`),
  };
}

// ── recheck after a low treatment ─────────────────────────────────────────────────────────────────
// Every logged low treatment gets one push "check again" after the recheck time (15 min by default), unless a
// newer treatment followed it (that one has its own timer) or it came from a planned meal (the plan reminds).
export interface TreatRow { id: string; occurred_at: string; recheck_sent_at: string | null }
export function treatRechecksDue(rows: TreatRow[], now: number, recheckMin = 15, skip: Set<string> = new Set()): TreatRow[] {
  const MINUTE = 60000, sorted = [...rows].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  return sorted.filter((r, i) => {
    const t = Date.parse(r.occurred_at), due = t + recheckMin * MINUTE;
    if (r.recheck_sent_at || skip.has(r.id) || now < due || now > due + 30 * MINUTE) return false;
    const next = sorted[i + 1];
    return !next || Date.parse(next.occurred_at) > now;   // a newer treatment already happened: its own recheck covers it
  });
}
export function treatRecheckMessage(lang: Lang = 'ar', g?: { mg: number; trend: number | null; unit: 'mgdl' | 'mmol' } | null, min = 15) {
  const en = lang === 'en', now = g ? nowLine(g.mg, g.trend, g.unit, lang) : null;
  return {
    title: `${MARK.warning} ${en ? 'Check her glucose again' : 'أعيدوا قياس السكر'}`,
    body: join(now, en ? `${dur(min, lang)} since the low treatment` : `مرّت ${dur(min, lang)} على علاج الانخفاض`),
  };
}
