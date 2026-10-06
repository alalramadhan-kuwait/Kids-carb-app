import { isEn, locale, t } from '../i18n';

/** Suggestions only: any category typed by the parents works too. Stored as data in Arabic; shown with tMaybe(). */
export const PRODUCT_CATEGORIES = [
  'توست', 'صمون', 'ناجت', 'بطاط مجمد', 'باستا', 'صلصة', 'كاتشب', 'مايونيز', 'حليب', 'لبن', 'روب', 'جبن', // i18n-ok
  'كريمة طبخ', 'برغر لحم', 'ملوخية', 'نشويات', 'لحوم ودجاج', 'بيض', 'فواكه', 'خضار', 'مشروبات', 'حلويات', 'آيس كريم', 'خبز', 'معجنات', 'كيك', 'بسكويت', 'سندويشات', 'طحين', // i18n-ok
  'مكسرات', 'سمك وروبيان', 'رز', 'حبوب وبقوليات', 'عصير طبيعي', 'حبوب الإفطار', 'فطور', 'سكر وعسل', 'شوكولاتة', 'سناكات', 'أخرى', // i18n-ok
];
export const RECIPE_CATEGORIES = ['دجاج', 'لحم', 'باستا', 'برغر', 'ناجت', 'فطور', 'أخرى']; // i18n-ok

const EMOJI: Record<string, string> = {
  'دجاج': '🍗', 'لحم': '🥩', 'باستا': '🍝', 'برغر': '🍔', 'ناجت': '🍟', 'فطور': '🍳', 'توست': '🍞', 'صمون': '🍞', // i18n-ok
  'بطاط مجمد': '🍟', 'صلصة': '🥫', 'كاتشب': '🥫', 'مايونيز': '🥫', 'حليب': '🥛', 'لبن': '🥛', 'روب': '🥛', 'جبن': '🧀', // i18n-ok
  'كريمة طبخ': '🥛', 'نشويات': '🍚', 'لحوم ودجاج': '🍗', 'بيض': '🥚', 'فواكه': '🍎', 'خضار': '🥬', 'ملوخية': '🥬', // i18n-ok
  'حلويات': '🍬', 'آيس كريم': '🍦', 'مشروبات': '🧃', // i18n-ok
  'خبز': '🫓', 'معجنات': '🥐', 'كيك': '🧁', 'بسكويت': '🍪', 'سندويشات': '🥪', 'طحين': '🌾', // i18n-ok
  'مكسرات': '🥜', 'سمك وروبيان': '🐟', 'رز': '🍚', 'حبوب وبقوليات': '🫘', 'عصير طبيعي': '🧃', 'حبوب الإفطار': '🥣', 'سكر وعسل': '🍯', 'شوكولاتة': '🍫', 'سناكات': '🍿', // i18n-ok
};
export const emojiFor = (category?: string | null) => (category && EMOJI[category]) || '🍽️';

export const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; // i18n-ok: data, English twin below
export const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayName = (d: Date) => (isEn() ? DAY_NAMES_EN : DAY_NAMES)[d.getDay()];
export const fmtDate = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
/** The family's clock, 12-hour, in Kuwait time whatever the phone's zone: "8:05 م" / "8:05 PM". */
export const kwClock = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuwait', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const AM_PM = () => (isEn() ? ['AM', 'PM'] : ['\u0635', '\u0645']);   // ص / م
/** An hour of the day as words, 12-hour: "2 AM" / «2 ص» (0 and 24 are midnight, 12 is noon). */
export const hourWord = (h: number) => { const x = ((h % 24) + 24) % 24; return `${x % 12 || 12} ${AM_PM()[x < 12 ? 0 : 1]}`; };
/** An hour on a graph's axis, short: "2a" / «2ص». */
export const hourTick = (h: number) => { const x = ((h % 24) + 24) % 24; return `${x % 12 || 12}${isEn() ? (x < 12 ? 'a' : 'p') : AM_PM()[x < 12 ? 0 : 1]}`; };
/** "HH:mm" (what a time field holds) shown 12-hour: "19:30" → "7:30 PM". */
export const hmWord = (hm: string | null | undefined) => { const m = /^(\d{1,2}):(\d{2})/.exec(hm ?? ''); if (!m) return '—'; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${AM_PM()[h < 12 ? 0 : 1]}`; };
export const fmtTime = (d: Date) => d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as any);
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const sameDay = (a: Date, b: Date) => isoDate(a) === isoDate(b);
export const relDay = (d: Date, today = new Date()) => {
  const diff = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  return diff === 0 ? t('اليوم') : diff === 1 ? t('أمس') : dayName(d);
};
