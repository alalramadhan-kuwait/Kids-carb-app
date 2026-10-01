// Alert state machine (GLUCOSE_PLAN section 6), pure so it can be tested. Runs on the server every minute.
// Thresholds come from the parents; a threshold left empty switches that alert off (urgent low included —
// the app has no built-in medical numbers). Messages state facts only: never a dose, never grams to give.

export type AlertKind = 'urgent_low' | 'low' | 'high' | 'no_data';
export type AlertState = 'pending' | 'active' | 'acknowledged';
export const ALERT_KINDS: AlertKind[] = ['urgent_low', 'low', 'high', 'no_data'];

export interface AlertCfg {
  urgentLow: number | null; low: number | null; high: number | null; // mg/dL
  lowDelay: number; highDelay: number; noDataMin: number; renotify: number; highRenotify: number; // minutes
}
export interface OpenAlert {
  id: string; kind: AlertKind; state: AlertState; started_at: string; active_at: string | null;
  last_notified_at: string | null; snoozed_until: string | null; clear_since: string | null;
  value_mgdl: number | null; worst_mgdl: number | null;
}
export interface Reading { taken_at: string; mg_dl: number; trend: number | null }
export type Notify = 'alert' | 'repeat' | 'resolved';
export interface Step {
  kind: AlertKind;
  op: 'create' | 'update' | 'delete' | 'resolve';
  id?: string;
  patch: Record<string, unknown>;
  notify?: Notify;
}

const MIN = 60000;
export const FRESH_MIN = 15;
const HOLD: Record<AlertKind, number> = { urgent_low: 10, low: 15, high: 15, no_data: 0 }; // minutes clear before resolving
const iso = (t: number) => new Date(t).toISOString();
const ms = (s: string | null) => (s ? Date.parse(s) : NaN);

export function evaluate(now: number, latest: Reading | null, cfg: AlertCfg, open: OpenAlert[], cgmConnected: boolean): Step[] {
  const steps: Step[] = [];
  const age = latest ? (now - Date.parse(latest.taken_at)) / MIN : Infinity;
  const fresh = age <= FRESH_MIN;
  const v = latest?.mg_dl ?? null;
  const byKind = new Map(open.map((a) => [a.kind, a]));
  const urgentOpen = byKind.get('urgent_low');
  const urgentSounding = !!urgentOpen && urgentOpen.state !== 'pending';

  for (const kind of ALERT_KINDS) {
    const a = byKind.get(kind) ?? null;
    let enabled: boolean, cond: boolean, clear: boolean, delay: number, renotify: number;
    switch (kind) {
      case 'urgent_low':
        enabled = cfg.urgentLow !== null; delay = 0; renotify = Math.min(cfg.renotify, 5);
        cond = fresh && v! <= cfg.urgentLow!; clear = fresh && v! >= cfg.urgentLow! + 10; break;
      case 'low':
        enabled = cfg.low !== null; delay = cfg.lowDelay; renotify = cfg.renotify;
        cond = fresh && v! <= cfg.low!; clear = fresh && v! >= cfg.low! + 10; break;
      case 'high':
        enabled = cfg.high !== null; delay = cfg.highDelay; renotify = cfg.highRenotify;
        cond = fresh && v! >= cfg.high!; clear = fresh && v! <= cfg.high! - 20; break;
      default:
        enabled = cgmConnected; delay = 0; renotify = Math.max(cfg.renotify, 15);
        cond = age > cfg.noDataMin; clear = !cond;
    }
    const worst = (w: number | null) => (v === null || kind === 'no_data' ? w : w === null ? v : kind === 'high' ? Math.max(w, v) : Math.min(w, v));
    const value = kind === 'no_data' ? null : fresh ? v : a?.value_mgdl ?? null;

    if (!a) {
      if (!enabled || !cond) continue;
      if (delay === 0) steps.push({ kind, op: 'create', patch: { state: 'active', started_at: iso(now), active_at: iso(now), last_notified_at: iso(now), value_mgdl: value, worst_mgdl: value }, notify: kind === 'low' && urgentSounding ? undefined : 'alert' });
      else steps.push({ kind, op: 'create', patch: { state: 'pending', started_at: iso(now), value_mgdl: value, worst_mgdl: value } });
      continue;
    }
    if (!enabled) { steps.push({ kind, op: a.state === 'pending' ? 'delete' : 'resolve', id: a.id, patch: { resolved_at: iso(now) } }); continue; }

    if (a.state === 'pending') {
      if (!cond) { steps.push({ kind, op: 'delete', id: a.id, patch: {} }); continue; }
      if (now - ms(a.started_at) >= delay * MIN) {
        steps.push({ kind, op: 'update', id: a.id, patch: { state: 'active', active_at: iso(now), last_notified_at: iso(now), value_mgdl: value, worst_mgdl: worst(a.worst_mgdl) }, notify: kind === 'low' && urgentSounding ? undefined : 'alert' });
      } else steps.push({ kind, op: 'update', id: a.id, patch: { value_mgdl: value, worst_mgdl: worst(a.worst_mgdl) } });
      continue;
    }

    // active or acknowledged
    if (clear) {
      const since = a.clear_since ? ms(a.clear_since) : now;
      if (now - since >= HOLD[kind] * MIN) {
        steps.push({ kind, op: 'resolve', id: a.id, patch: { resolved_at: iso(now), value_mgdl: value }, notify: kind === 'high' ? undefined : 'resolved' });
      } else steps.push({ kind, op: 'update', id: a.id, patch: { clear_since: iso(since), value_mgdl: value, worst_mgdl: worst(a.worst_mgdl) } });
      continue;
    }
    const patch: Record<string, unknown> = { clear_since: null, value_mgdl: value, worst_mgdl: worst(a.worst_mgdl) };
    let notify: Notify | undefined;
    const quietLow = kind === 'low' && urgentSounding;
    if (a.state === 'acknowledged') {
      if (cond && a.snoozed_until && now >= ms(a.snoozed_until)) {
        Object.assign(patch, { state: 'active', snoozed_until: null, last_notified_at: iso(now) });
        if (!quietLow) notify = 'repeat';
      }
    } else if (cond && !quietLow && now - ms(a.last_notified_at ?? a.active_at ?? a.started_at) >= renotify * MIN) {
      patch.last_notified_at = iso(now); notify = 'repeat';
    }
    steps.push({ kind, op: 'update', id: a.id, patch, notify });
  }
  return steps;
}

// ── wording ────────────────────────────────────────────────────────────────────
const ARROW: Record<number, string> = { 1: '↓', 2: '↘', 3: '→', 4: '↗', 5: '↑' };
const fmt = (mg: number, unit: 'mgdl' | 'mmol') => (unit === 'mmol' ? (Math.round((mg / 18.016) * 10) / 10).toFixed(1) : String(Math.round(mg)));
const NAME: Record<AlertKind, string> = { urgent_low: 'منخفض جدًا', low: 'منخفض', high: 'مرتفع', no_data: 'لا توجد قراءة' };

export function alertMessage(
  kind: AlertKind, notify: Notify, o: { child: string; value: number | null; trend: number | null; unit: 'mgdl' | 'mmol'; minutes: number },
) {
  const val = o.value !== null ? `${fmt(o.value, o.unit)}${o.trend ? ' ' + ARROW[o.trend] : ''}` : '';
  const since = o.minutes < 1 ? 'الآن' : `منذ ${Math.round(o.minutes)} د`;
  if (notify === 'resolved') {
    const title = kind === 'no_data' ? `${o.child}: رجعت القراءات` : `${o.child}: ارتفعت إلى ${val}`.trim();
    return { title, body: 'انتهى التنبيه', urgency: 'normal' as const };
  }
  const title = kind === 'no_data' ? `${o.child}: لا توجد قراءة ${since}` : `${o.child}: ${NAME[kind]} ${val}`;
  const body = kind === 'no_data'
    ? 'تأكد من الحساس وجوال القراءة · خطة الطبيب'
    : `${notify === 'repeat' ? 'ما زال · ' : ''}${since} · خطة الطبيب`;
  return { title, body, urgency: kind === 'high' ? ('normal' as const) : ('high' as const) };
}

export function ackMessage(kind: AlertKind, child: string, who: string, action: 'on_it' | 'treated') {
  return { title: `${who} ${action === 'treated' ? 'عالجها' : 'عليها'} ✓`, body: `${child}: ${NAME[kind]}`, urgency: 'normal' as const };
}
