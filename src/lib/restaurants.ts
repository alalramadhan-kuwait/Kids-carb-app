// Restaurants: fast food kept apart from home food. A product belongs to a restaurant by its brand; inside a
// restaurant the menu is shown in sections (burgers, chicken, fries…) taken from the product's category. Pure.

export interface Restaurant { key: string; brand: string; label: string; bg: string; fg: string; mark: string; lead?: string }

// the badge colours and letters stand in for each restaurant's logo
export const RESTAURANTS: Restaurant[] = [
  { key: 'mcd', brand: "McDonald's", label: 'ماكدونالدز', bg: '#DA291C', fg: '#FFC72C', mark: 'M' }, // i18n-ok: stored labels, shown via tMaybe
  { key: 'bk', brand: 'Burger King', label: 'برغر كنغ', bg: '#F5EBDC', fg: '#D62300', mark: 'BK' }, // i18n-ok
  { key: 'kfc', brand: 'KFC', label: 'كنتاكي', bg: '#E4002B', fg: '#FFFFFF', mark: 'KFC' }, // i18n-ok
  { key: 'pick', brand: 'PICK', label: 'بيك', bg: '#0BA182', fg: '#FFFFFF', mark: 'PICK', lead: 'frozen' }, // i18n-ok: frozen yogurt first
];

export const restaurantOf = (brand: string | null | undefined): Restaurant | null =>
  RESTAURANTS.find((r) => r.brand.toLowerCase() === (brand ?? '').trim().toLowerCase()) ?? null;
export const restaurantByKey = (key: string | null | undefined) => RESTAURANTS.find((r) => r.key === key) ?? null;

export interface MenuSection { key: string; label: string; emoji: string; cats: string[] }
export const MENU_SECTIONS: MenuSection[] = [
  { key: 'burgers', label: 'برغر وسندويشات', emoji: '🍔', cats: ['سندويشات', 'برغر لحم'] }, // i18n-ok: stored labels and categories
  { key: 'chicken', label: 'دجاج وناجت', emoji: '🍗', cats: ['دجاج', 'ناجت', 'لحوم ودجاج'] }, // i18n-ok
  { key: 'sides', label: 'بطاط وأطباق جانبية', emoji: '🍟', cats: ['نشويات', 'خضار', 'معجنات', 'رز', 'فطور'] }, // i18n-ok
  { key: 'sauces', label: 'صوص', emoji: '🥫', cats: ['صلصة', 'كاتشب', 'مايونيز'] }, // i18n-ok
  { key: 'drinks', label: 'مشروبات', emoji: '🥤', cats: ['مشروبات', 'عصير طبيعي', 'حليب'] }, // i18n-ok
  { key: 'frozen', label: 'فروزن يوغرت وآيس كريم', emoji: '🍦', cats: ['آيس كريم'] }, // i18n-ok
  { key: 'fruit', label: 'فواكه وأكواب', emoji: '🍓', cats: ['فواكه'] }, // i18n-ok
  { key: 'sweets', label: 'حلى وكيك', emoji: '🍰', cats: ['حلويات', 'كيك', 'بسكويت'] }, // i18n-ok
];
const OTHER_SECTION: MenuSection = { key: 'other', label: 'أخرى', emoji: '🍽️', cats: [] }; // i18n-ok

/** A restaurant's menu in sections, in the fixed order (other last); empty sections left out. */
export function menuOf<T extends { category: string | null }>(items: T[], lead?: string): { section: MenuSection; items: T[] }[] {
  // the restaurant's own speciality first (PICK: frozen yogurt), then the usual order
  const all = [...MENU_SECTIONS.filter((s) => s.key === lead), ...MENU_SECTIONS.filter((s) => s.key !== lead), OTHER_SECTION];
  const at = (c: string | null) => MENU_SECTIONS.find((s) => !!c && s.cats.includes(c)) ?? OTHER_SECTION;
  return all.map((section) => ({ section, items: items.filter((i) => at(i.category).key === section.key) })).filter((x) => x.items.length);
}
