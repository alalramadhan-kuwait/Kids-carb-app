// Alert state machine (GLUCOSE_PLAN section 6), pure so it can be tested. Runs on the server every minute.
// Thresholds come from the parents; a threshold left empty switches that alert off (urgent low included —
// the app has no built-in medical numbers). Messages state facts only: never a dose, never grams to give.

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
const HOLD: Record<AlertKind, number> = { urgent_low: 10, low: 15, predicted_low: 5, high: 15, no_data: 0, rapid_fall: 5, rapid_rise: 5 }; // minutes clear before resolving
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

/** The low limit in effect now (night and school may have their own). */
export function lowNow(now: number, cfg: AlertCfg): number | null {
  const p = profileAt(now, cfg);
  return p === 'night' ? cfg.night?.low ?? cfg.low : p === 'school' ? cfg.school?.low ?? cfg.low : cfg.low;
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
  const RF = cfg.fallRate ?? cfg.rapidRate ?? null, RR = cfg.riseRate ?? cfg.rapidRate ?? null;
  const P = cfg.predictLowMin ?? null;
  // where the last 15 minutes' fall leads in P minutes (a straight line: the trend, not a forecast of food or insulin)
  const ahead = fresh && v !== null && rate !== null && P !== null ? v + rate * P : null;
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
      case 'predicted_low':
        // still above the low limit but heading below it within P minutes; once she is low, the low alert takes over
        enabled = low !== null && P !== null; delay = 2; renotify = 24 * 60;
        cond = ahead !== null && rate! < 0 && v! > low! && ahead <= low!;
        clear = fresh && (v! <= low! || ahead === null || ahead > low! + 5); break;
      case 'rapid_fall':
        enabled = RF !== null; delay = 2; renotify = 24 * 60;
        cond = rate !== null && rate <= -RF!; clear = rate !== null && rate > -RF! * 0.6; break;
      case 'rapid_rise':
        enabled = RR !== null; delay = 2; renotify = 24 * 60;
        cond = rate !== null && rate >= RR!; clear = rate !== null && rate < RR! * 0.6; break;
      default:
        enabled = cgmConnected; delay = 0; renotify = Math.max(cfg.renotify, 15);
        cond = age > cfg.noDataMin; clear = !cond;
    }
    const silent = kind === 'high' && highSilent;
    const worst = (w: number | null) => (v === null || kind === 'no_data' ? w : w === null ? v : kind === 'high' || kind === 'rapid_rise' ? Math.max(w, v) : Math.min(w, v));
    const value = kind === 'no_data' ? null : fresh ? v : a?.value_mgdl ?? null;
    const lowSounding = ['low', 'urgent_low'].some((k) => { const o = byKind.get(k as AlertKind); return !!o && o.state !== 'pending'; });
    const quietLow = (kind === 'low' && urgentSounding) || (kind === 'predicted_low' && lowSounding);

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
        const quietResolve = kind === 'high' || kind === 'rapid_fall' || kind === 'rapid_rise' || kind === 'predicted_low';
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
const LRI = '\u2066', PDI = '\u2069'; // keeps "5.2 ↘" together inside Arabic text
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
  ahead?: number | null; // the "low expected" look-ahead (minutes), when the rate cannot give a time
}
/** Minutes until the current fall reaches the low limit, if it is falling. */
export function minutesToLow(f: AlertFacts): number | null {
  if (f.value === null || f.low == null || f.rate == null || f.rate >= 0 || f.value <= f.low) return null;
  return (f.value - f.low) / -f.rate;
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
      const m = Math.round(eta ?? f.ahead ?? 20);
      return out(en ? `Low expected in ${dur(m, lang)}` : `انخفاض متوقع خلال ${dur(m, lang)}`, now, lowTxt && (en ? `May drop below ${lowTxt}` : `قد ينزل تحت ${lowTxt}`));
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

/** Sensor expiry reminder: when it ends, in Kuwait time, so a change can be planned outside school or sleep. */
export function sensorMessage(due: '24' | '2', endsAt: number, lang: Lang = 'ar') {
  const en = lang === 'en';
  const k = new Date(endsAt + 3 * 3600000);
  const at = `${LRI}${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}${PDI}`;
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
const kwClock = (ms: number) => { const k = new Date(ms + 3 * 3600000); return `${LRI}${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}${PDI}`; };

/** Plan reminders; `g` is her glucose now, when there is a recent reading. */
export function planMessage(kind: PlanPush, p: PlanRow, lang: Lang = 'ar', g?: { mg: number; trend: number | null; unit: 'mgdl' | 'mmol' } | null) {
  const en = lang === 'en', meal = (en ? SLOT_EN : SLOT_AR)[p.slot] ?? p.name;
  const now = g ? nowLine(g.mg, g.trend, g.unit, lang) : null;
  const dose = Date.parse(p.dose_at);
  if (kind === 'check') return {
    title: `${MARK.info} ${en ? `${meal} plan · dose at ${kwClock(dose)}` : `خطة ${meal} · الجرعة ${kwClock(dose)}`}`,
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
