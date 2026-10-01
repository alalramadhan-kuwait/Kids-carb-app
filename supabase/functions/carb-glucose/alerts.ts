// Alert state machine (GLUCOSE_PLAN section 6), pure so it can be tested. Runs on the server every minute.
// Thresholds come from the parents; a threshold left empty switches that alert off (urgent low included —
// the app has no built-in medical numbers). Messages state facts only: never a dose, never grams to give.

export type AlertKind = 'urgent_low' | 'low' | 'high' | 'no_data' | 'rapid_fall' | 'rapid_rise';
export type AlertState = 'pending' | 'active' | 'acknowledged';
export type Profile = 'day' | 'night' | 'school';
export const ALERT_KINDS: AlertKind[] = ['urgent_low', 'low', 'high', 'no_data', 'rapid_fall', 'rapid_rise'];

export interface AlertCfg {
  urgentLow: number | null; low: number | null; high: number | null; // mg/dL (day profile)
  lowDelay: number; highDelay: number; noDataMin: number; renotify: number; highRenotify: number; // minutes
  rapidRate?: number | null;   // mg/dL per minute; null = rapid alerts off
  escalateMin?: number;        // minutes without "I'm on it" before the backup parent is told
  night?: { start: string; end: string; low: number | null; high: number | null; highSilent: boolean } | null;
  school?: { days: number[]; start: string; end: string; low: number | null; high: number | null } | null;
}
export interface OpenAlert {
  id: string; kind: AlertKind; state: AlertState; started_at: string; active_at: string | null;
  last_notified_at: string | null; snoozed_until: string | null; clear_since: string | null;
  value_mgdl: number | null; worst_mgdl: number | null; escalated_at?: string | null;
}
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
const HOLD: Record<AlertKind, number> = { urgent_low: 10, low: 15, high: 15, no_data: 0, rapid_fall: 5, rapid_rise: 5 }; // minutes clear before resolving
const iso = (t: number) => new Date(t).toISOString();
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

/** Least-squares slope over the 15 minutes up to the last reading (mg/dL per minute); needs ≥ 3 points over ≥ 5 min, no gap. */
export function rate15(readings: Reading[]): number | null {
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

export function evaluate(now: number, readings: Reading[], cfg: AlertCfg, open: OpenAlert[], cgmConnected: boolean): Step[] {
  const steps: Step[] = [];
  const latest = readings.length ? readings[readings.length - 1] : null;
  const age = latest ? (now - Date.parse(latest.taken_at)) / MIN : Infinity;
  const fresh = age <= FRESH_MIN;
  const v = latest?.mg_dl ?? null;
  const profile = profileAt(now, cfg);
  const low = profile === 'night' ? cfg.night?.low ?? cfg.low : profile === 'school' ? cfg.school?.low ?? cfg.low : cfg.low;
  const high = profile === 'night' ? cfg.night?.high ?? cfg.high : profile === 'school' ? cfg.school?.high ?? cfg.high : cfg.high;
  const highSilent = profile === 'night' && !!cfg.night?.highSilent;
  const rate = fresh ? rate15(readings) : null;
  const R = cfg.rapidRate ?? null;
  const byKind = new Map(open.map((a) => [a.kind, a]));
  const urgentOpen = byKind.get('urgent_low');
  const urgentSounding = !!urgentOpen && urgentOpen.state !== 'pending';
  const escalateAfter = cfg.escalateMin ?? 10;

  for (const kind of ALERT_KINDS) {
    const a = byKind.get(kind) ?? null;
    let enabled: boolean, cond: boolean, clear: boolean, delay: number, renotify: number;
    switch (kind) {
      case 'urgent_low':
        enabled = cfg.urgentLow !== null; delay = 0; renotify = Math.min(cfg.renotify, 5);
        cond = fresh && v! <= cfg.urgentLow!; clear = fresh && v! >= cfg.urgentLow! + 10; break;
      case 'low':
        enabled = low !== null; delay = cfg.lowDelay; renotify = cfg.renotify;
        cond = fresh && v! <= low!; clear = fresh && v! >= low! + 10; break;
      case 'high':
        enabled = high !== null; delay = cfg.highDelay; renotify = cfg.highRenotify;
        cond = fresh && v! >= high!; clear = fresh && v! <= high! - 20; break;
      case 'rapid_fall':
        enabled = R !== null; delay = 2; renotify = 24 * 60;
        cond = rate !== null && rate <= -R!; clear = rate !== null && rate > -R! * 0.6; break;
      case 'rapid_rise':
        enabled = R !== null; delay = 2; renotify = 24 * 60;
        cond = rate !== null && rate >= R!; clear = rate !== null && rate < R! * 0.6; break;
      default:
        enabled = cgmConnected; delay = 0; renotify = Math.max(cfg.renotify, 15);
        cond = age > cfg.noDataMin; clear = !cond;
    }
    const silent = kind === 'high' && highSilent;
    const worst = (w: number | null) => (v === null || kind === 'no_data' ? w : w === null ? v : kind === 'high' || kind === 'rapid_rise' ? Math.max(w, v) : Math.min(w, v));
    const value = kind === 'no_data' ? null : fresh ? v : a?.value_mgdl ?? null;
    const quietLow = kind === 'low' && urgentSounding;

    if (!a) {
      if (!enabled || !cond) continue;
      if (delay === 0) steps.push({ kind, op: 'create', patch: { state: 'active', profile, started_at: iso(now), active_at: iso(now), last_notified_at: iso(now), value_mgdl: value, worst_mgdl: value }, notify: quietLow ? undefined : 'alert', silent });
      else steps.push({ kind, op: 'create', patch: { state: 'pending', profile, started_at: iso(now), value_mgdl: value, worst_mgdl: value } });
      continue;
    }
    if (!enabled) { steps.push({ kind, op: a.state === 'pending' ? 'delete' : 'resolve', id: a.id, patch: { resolved_at: iso(now) } }); continue; }

    if (a.state === 'pending') {
      if (!cond) { steps.push({ kind, op: 'delete', id: a.id, patch: {} }); continue; }
      if (now - ms(a.started_at) >= delay * MIN) {
        steps.push({ kind, op: 'update', id: a.id, patch: { state: 'active', active_at: iso(now), last_notified_at: iso(now), value_mgdl: value, worst_mgdl: worst(a.worst_mgdl) }, notify: quietLow ? undefined : 'alert', silent });
      } else steps.push({ kind, op: 'update', id: a.id, patch: { value_mgdl: value, worst_mgdl: worst(a.worst_mgdl) } });
      continue;
    }

    // active or acknowledged
    if (clear) {
      const since = a.clear_since ? ms(a.clear_since) : now;
      if (now - since >= HOLD[kind] * MIN) {
        const quietResolve = kind === 'high' || kind === 'rapid_fall' || kind === 'rapid_rise';
        steps.push({ kind, op: 'resolve', id: a.id, patch: { resolved_at: iso(now), value_mgdl: value }, notify: quietResolve ? undefined : 'resolved' });
      } else steps.push({ kind, op: 'update', id: a.id, patch: { clear_since: iso(since), value_mgdl: value, worst_mgdl: worst(a.worst_mgdl) } });
      continue;
    }
    const patch: Record<string, unknown> = { clear_since: null, value_mgdl: value, worst_mgdl: worst(a.worst_mgdl) };
    let notify: Notify | undefined;
    if (a.state === 'acknowledged') {
      if (cond && a.snoozed_until && now >= ms(a.snoozed_until)) {
        Object.assign(patch, { state: 'active', snoozed_until: null, last_notified_at: iso(now) });
        if (!quietLow) notify = 'repeat';
      }
    } else {
      // nobody has said "I'm on it": tell the backup parent once, after the set minutes (urgent low sooner)
      const escalates = kind === 'urgent_low' || kind === 'low' || kind === 'no_data';
      const after = kind === 'urgent_low' ? Math.min(escalateAfter, 5) : escalateAfter;
      if (escalates && !a.escalated_at && !quietLow && now - ms(a.active_at ?? a.started_at) >= after * MIN) {
        Object.assign(patch, { escalated_at: iso(now), last_notified_at: iso(now) }); notify = 'escalate';
      } else if (cond && !quietLow && now - ms(a.last_notified_at ?? a.active_at ?? a.started_at) >= renotify * MIN) {
        patch.last_notified_at = iso(now); notify = 'repeat';
      }
    }
    steps.push({ kind, op: 'update', id: a.id, patch, notify, silent });
  }
  return steps;
}

// ── wording ────────────────────────────────────────────────────────────────────
const ARROW: Record<number, string> = { 1: '↓', 2: '↘', 3: '→', 4: '↗', 5: '↑' };
const fmt = (mg: number, unit: 'mgdl' | 'mmol') => (unit === 'mmol' ? (Math.round((mg / 18.016) * 10) / 10).toFixed(1) : String(Math.round(mg)));
export type Lang = 'ar' | 'en';
export const ALERT_NAME: Record<AlertKind, string> = {
  urgent_low: 'منخفض جدًا', low: 'منخفض', high: 'مرتفع', no_data: 'لا توجد قراءة', rapid_fall: 'نزول سريع', rapid_rise: 'صعود سريع',
};
const ALERT_NAME_EN: Record<AlertKind, string> = {
  urgent_low: 'Very low', low: 'Low', high: 'High', no_data: 'No reading', rapid_fall: 'Falling fast', rapid_rise: 'Rising fast',
};
/** The stored child name is Arabic; English alerts write her name in English. */
const childName = (child: string, lang: Lang) => (lang === 'en' && child === 'ليان' ? 'Layan' : child);

/** Push wording, in each parent's app language (carb.members.lang). */
export function alertMessage(
  kind: AlertKind, notify: Notify, o: { child: string; value: number | null; trend: number | null; unit: 'mgdl' | 'mmol'; minutes: number }, lang: Lang = 'ar',
) {
  const en = lang === 'en', child = childName(o.child, lang);
  const val = o.value !== null ? `${fmt(o.value, o.unit)}${o.trend ? ' ' + ARROW[o.trend] : ''}` : '';
  const since = o.minutes < 1 ? (en ? 'now' : 'الآن') : en ? `for ${Math.round(o.minutes)} min` : `منذ ${Math.round(o.minutes)} د`;
  const plan = en ? "doctor's plan" : 'خطة الطبيب';
  if (notify === 'resolved') {
    const title = kind === 'no_data' ? (en ? `${child}: readings are back` : `${child}: رجعت القراءات`) : (en ? `${child}: up to ${val}` : `${child}: ارتفعت إلى ${val}`).trim();
    return { title, body: en ? 'Alert ended' : 'انتهى التنبيه', urgency: 'normal' as const };
  }
  const head = notify === 'escalate' ? (en ? 'No one answered · ' : 'لم يرد أحد · ') : '';
  const title = kind === 'no_data'
    ? `${head}${child}: ${en ? `no reading ${since}` : `لا توجد قراءة ${since}`}`
    : `${head}${child}: ${(en ? ALERT_NAME_EN : ALERT_NAME)[kind]} ${val}`;
  const body = kind === 'no_data'
    ? (en ? `Check the sensor and the reading phone · ${plan}` : `تأكد من الحساس وجوال القراءة · ${plan}`)
    : `${notify === 'repeat' ? (en ? 'Still · ' : 'ما زال · ') : ''}${since} · ${plan}`;
  return { title, body, urgency: kind === 'high' || kind === 'rapid_rise' ? ('normal' as const) : ('high' as const) };
}

export function ackMessage(kind: AlertKind, child: string, who: string | null, action: 'on_it' | 'treated', lang: Lang = 'ar') {
  const en = lang === 'en', name = who || (en ? 'A parent' : 'أحد الوالدين');
  const did = en ? (action === 'treated' ? 'treated it' : 'is on it') : action === 'treated' ? 'عالجها' : 'عليها';
  return { title: `${name} ${did} ✓`, body: `${childName(child, lang)}: ${(en ? ALERT_NAME_EN : ALERT_NAME)[kind]}`, urgency: 'normal' as const };
}

export const testMessage = (lang: Lang = 'ar') =>
  lang === 'en' ? { title: 'Test alert', body: 'Alerts work on this phone' } : { title: 'تنبيه تجربة', body: 'التنبيهات تعمل على هذا الجوال' };

/** Who is told: first alerts and repeats go to the primary parents (everyone if none is primary); escalation adds the backups. */
export function recipients(members: { user_id: string; alert_role: string }[], notify: Notify): string[] {
  const on = members.filter((m) => m.alert_role !== 'off');
  const primary = on.filter((m) => m.alert_role === 'primary');
  if (notify === 'escalate') return on.map((m) => m.user_id);
  return (primary.length ? primary : on).map((m) => m.user_id);
}
