import { t, tr } from '../i18n';
export type GlucoseUnit = 'mmol' | 'mgdl';
export interface Reading { taken_at: string; mg_dl: number; trend: number | null }
export interface GlucoseState {
  connected: boolean;
  account_hint: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  latest: Reading | null;
  readings: Reading[];
  /** the sensor LibreLinkUp reports: serial and activation time */
  sensor?: { sn: string | null; started_at: string } | null;
  error?: string;
}

const MMOL = 18.016;
export const formatGlucose = (mgdl: number, unit: GlucoseUnit) => (unit === 'mmol' ? (Math.round((mgdl / MMOL) * 10) / 10).toFixed(1) : String(Math.round(mgdl)));
export const toMgdl = (v: number, unit: GlucoseUnit) => Math.round(unit === 'mmol' ? v * MMOL : v);
export const unitLabel = (u: GlucoseUnit) => (u === 'mmol' ? t('مليمول/ل') : t('ملغ/دل'));


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

/**
 * The range used on screen: the parents' (from the doctor) when set; until then, at the parents' request, the
 * international reporting range 70–180 mg/dL (3.9–10.0), always labelled «مرجعي». Alerts never use it.
 */
export const REF_RANGE = { low: 70, high: 180 } as const;
export function effectiveRange(low: number | null, high: number | null) {
  return low !== null || high !== null ? { low, high, reference: false } : { low: REF_RANGE.low as number, high: REF_RANGE.high as number, reference: true };
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

export const GLUCOSE_ERRORS: Record<string, string> = tr({ // i18n-ok: values translated when read
  bad_credentials: 'البريد أو كلمة المرور غير صحيحين. استخدم حساب LibreLinkUp (المتابع)، وليس حساب Libre الرئيسي.', // i18n-ok
  terms_required: 'افتح تطبيق LibreLinkUp على الجوال مرة واحدة ووافق على الشروط، ثم أعد المحاولة.', // i18n-ok
  version_rejected: 'Abbott رفضت إصدار الاتصال. يلزم تحديث التطبيق، أخبر المطوّر.', // i18n-ok
  rate_limited: 'Abbott تحدّ من عدد الطلبات الآن. ستُحدَّث القراءة تلقائيًا بعد قليل.', // i18n-ok
  no_data: 'خدمة LibreLinkUp لم ترسل قراءات. تحقق أن تطبيق Libre على جوال ليان يعمل ومتصل بالإنترنت.', // i18n-ok
  no_connection: 'لا توجد مشاركة. من تطبيق Libre الرئيسي شارك القراءات مع حساب LibreLinkUp هذا.', // i18n-ok
  upstream: 'تعذّر الوصول إلى خدمة LibreLinkUp. حاول بعد قليل.', // i18n-ok
  not_allowed: 'غير مسموح.', // i18n-ok
  server: 'خطأ في الخادم.', // i18n-ok
  bad_input: 'اكتب البريد وكلمة المرور.', // i18n-ok
});
