// Pure helpers for the LibreLinkUp client. No Deno or Supabase imports, so the app's tests can run them.

/** Abbott rejects versions below 4.16.0 (HTTP 403, code 920). Raise this if they raise the floor. */
export const LLU_VERSION = '4.16.0';
export const LLU_PRODUCT = 'llu.android';

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Abbott redirects an account to its regional host, e.g. {data:{redirect:true, region:"eu"}}. */
export function hostFor(region?: string | null): string {
  if (!region) return 'https://api.libreview.io';
  if (!/^[a-z0-9]{2,6}$/i.test(region)) throw new Error('bad region');
  return `https://api-${region.toLowerCase()}.libreview.io`;
}

/** "10/1/2026 8:05:09 AM" (US order, 12-hour) -> ISO string in UTC, or null. */
export function parseLluTimestamp(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})\s?(AM|PM)$/i);
  if (!m) return null;
  const [, mo, d, y, h, mi, se, ap] = m;
  let hour = Number(h) % 12;
  if (ap.toUpperCase() === 'PM') hour += 12;
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, Number(mi), Number(se));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export interface Reading { taken_at: string; mg_dl: number; trend: number | null }

/** One LibreLinkUp measurement -> a reading, or null if it cannot be trusted. */
export function toReading(m: any): Reading | null {
  if (!m) return null;
  // FactoryTimestamp is UTC; Timestamp is the phone's local time, so only the former is safe.
  const taken_at = parseLluTimestamp(m.FactoryTimestamp);
  if (!taken_at) return null;
  let mg = Number(m.ValueInMgPerDl);
  if (!Number.isFinite(mg) || mg <= 0) {
    const v = Number(m.Value);
    if (!Number.isFinite(v) || v <= 0) return null;
    mg = v < 35 ? v * 18.016 : v; // a value under 35 can only be mmol/L
  }
  mg = Math.round(mg);
  if (mg < 10 || mg > 900) return null;
  const t = Number(m.TrendArrow);
  return { taken_at, mg_dl: mg, trend: t >= 1 && t <= 5 ? t : null };
}

export function readingsFromGraph(data: any): Reading[] {
  const out = new Map<string, Reading>();
  for (const m of data?.graphData ?? []) {
    const r = toReading(m);
    if (r) out.set(r.taken_at, r);
  }
  const current = toReading(data?.connection?.glucoseMeasurement ?? data?.connection?.glucoseItem);
  if (current) out.set(current.taken_at, current); // only the current one carries the trend arrow
  return [...out.values()].sort((a, b) => a.taken_at.localeCompare(b.taken_at));
}

export function maskEmail(email: string): string {
  const [u, d] = email.split('@');
  return d ? `${u.slice(0, 1)}***@${d}` : '***';
}

/** Do not hit Abbott more often than this, however many screens are open. */
export function tooSoon(lastFetchIso: string | null | undefined, now: number, seconds = 50): boolean {
  if (!lastFetchIso) return false;
  return now - new Date(lastFetchIso).getTime() < seconds * 1000;
}

export type LluErrorCode = 'bad_credentials' | 'terms_required' | 'version_rejected' | 'rate_limited' | 'no_connection' | 'upstream';

export class LluError extends Error {
  constructor(public code: LluErrorCode, detail = '') { super(detail || code); }
}

/** Turn a LibreLinkUp login response into a code the app can explain in Arabic. */
export function loginProblem(http: number, json: any): LluErrorCode | null {
  if (http === 429) return 'rate_limited';
  if (http === 403 && (json?.status === 920 || json?.code === 920)) return 'version_rejected';
  if (json?.status === 2) return 'bad_credentials';
  if (json?.status === 4 || json?.data?.step) return 'terms_required';
  if (http >= 400 || (json && json.status !== 0 && !json?.data?.redirect)) return http === 401 ? 'bad_credentials' : 'upstream';
  return null;
}
