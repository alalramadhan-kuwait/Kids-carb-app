/** Suggestions only: any category typed by the parents works too. */
export const PRODUCT_CATEGORIES = [
  'توست', 'صمون', 'ناجت', 'بطاط مجمد', 'باستا', 'صلصة', 'كاتشب', 'مايونيز', 'حليب', 'لبن', 'روب', 'جبن',
  'كريمة طبخ', 'برغر لحم', 'ملوخية', 'نشويات', 'لحوم ودجاج', 'بيض', 'فواكه', 'خضار', 'مشروبات', 'أخرى',
];
export const RECIPE_CATEGORIES = ['دجاج', 'لحم', 'باستا', 'برغر', 'ناجت', 'فطور', 'أخرى'];

const EMOJI: Record<string, string> = {
  'دجاج': '🍗', 'لحم': '🥩', 'باستا': '🍝', 'برغر': '🍔', 'ناجت': '🍟', 'فطور': '🍳', 'توست': '🍞', 'صمون': '🍞',
  'بطاط مجمد': '🍟', 'صلصة': '🥫', 'كاتشب': '🥫', 'مايونيز': '🥫', 'حليب': '🥛', 'لبن': '🥛', 'روب': '🥛', 'جبن': '🧀',
  'كريمة طبخ': '🥛', 'نشويات': '🍚', 'لحوم ودجاج': '🍗', 'بيض': '🥚', 'فواكه': '🍎', 'خضار': '🥬', 'ملوخية': '🥬',
};
export const emojiFor = (category?: string | null) => (category && EMOJI[category]) || '🍽️';

export const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const dayName = (d: Date) => DAY_NAMES[d.getDay()];
export const fmtDate = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
export const fmtTime = (d: Date) => d.toLocaleTimeString('ar-KW', { hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as any);
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const sameDay = (a: Date, b: Date) => isoDate(a) === isoDate(b);
export const relDay = (d: Date, today = new Date()) => {
  const diff = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  return diff === 0 ? 'اليوم' : diff === 1 ? 'أمس' : dayName(d);
};
