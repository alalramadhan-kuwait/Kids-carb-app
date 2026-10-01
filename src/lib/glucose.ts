export type GlucoseUnit = 'mmol' | 'mgdl';
export interface Reading { taken_at: string; mg_dl: number; trend: number | null }
export interface GlucoseState {
  connected: boolean;
  account_hint: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  latest: Reading | null;
  readings: Reading[];
  error?: string;
}

const MMOL = 18.016;
export const formatGlucose = (mgdl: number, unit: GlucoseUnit) => (unit === 'mmol' ? (Math.round((mgdl / MMOL) * 10) / 10).toFixed(1) : String(Math.round(mgdl)));
export const toMgdl = (v: number, unit: GlucoseUnit) => Math.round(unit === 'mmol' ? v * MMOL : v);
export const unitLabel = (u: GlucoseUnit) => (u === 'mmol' ? 'mmol/L' : 'mg/dL');


/** A number on screen must say how old it is: a stale reading looks exactly like a live one. */
export function glucoseAge(takenAt: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(takenAt).getTime()) / 60000));
  return { minutes, state: minutes <= 15 ? 'fresh' : minutes <= 30 ? 'old' : 'stale' } as const;
}

/** Only colours when the parents have entered a range. No default medical range is ever assumed. */
export function glucoseLevel(mgdl: number, low: number | null, high: number | null): 'none' | 'low' | 'in' | 'high' {
  if (low === null && high === null) return 'none';
  if (low !== null && mgdl < low) return 'low';
  if (high !== null && mgdl > high) return 'high';
  return 'in';
}

/** Status for the chip next to the number. Needs the parents' range; urgent low / very high use the reporting bands. */
export type GlucoseStatus = 'urgent_low' | 'low' | 'in_range' | 'high' | 'very_high';
export function glucoseStatus(mgdl: number, low: number | null, high: number | null): GlucoseStatus | null {
  if (low === null && high === null) return null;
  if (mgdl < 54) return 'urgent_low';
  if (low !== null && mgdl < low) return 'low';
  if (high !== null && mgdl > high) return mgdl > 250 ? 'very_high' : 'high';
  return 'in_range';
}

/** Add a pushed reading to the 3-hour window: no duplicates, sorted, newest is "latest". */
export function mergeReading(g: GlucoseState, r: Reading, now = Date.now()): GlucoseState {
  const since = now - 3 * 3600 * 1000;
  const map = new Map(g.readings.map((x) => [x.taken_at, x]));
  map.set(r.taken_at, r);
  const readings = [...map.values()].filter((x) => new Date(x.taken_at).getTime() >= since).sort((a, b) => a.taken_at.localeCompare(b.taken_at));
  return { ...g, readings, latest: readings[readings.length - 1] ?? g.latest };
}

export const GLUCOSE_ERRORS: Record<string, string> = {
  bad_credentials: 'البريد أو كلمة المرور غير صحيحين. استخدم حساب LibreLinkUp (المتابع)، وليس حساب Libre الرئيسي.',
  terms_required: 'افتح تطبيق LibreLinkUp على الجوال مرة واحدة ووافق على الشروط، ثم أعد المحاولة.',
  version_rejected: 'Abbott رفضت إصدار الاتصال. يلزم تحديث التطبيق، أخبر المطوّر.',
  rate_limited: 'Abbott تحدّ من عدد الطلبات الآن. ستُحدَّث القراءة تلقائيًا بعد قليل.',
  no_data: 'خدمة LibreLinkUp لم ترسل قراءات. تحقق أن تطبيق Libre على جوال ليان يعمل ومتصل بالإنترنت.',
  no_connection: 'لا توجد مشاركة. من تطبيق Libre الرئيسي شارك القراءات مع حساب LibreLinkUp هذا.',
  upstream: 'تعذّر الوصول إلى خدمة LibreLinkUp. حاول بعد قليل.',
  not_allowed: 'غير مسموح.',
  server: 'خطأ في الخادم.',
  bad_input: 'اكتب البريد وكلمة المرور.',
};
