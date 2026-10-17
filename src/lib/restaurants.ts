// Restaurants: fast food kept apart from home food. A product belongs to a restaurant by its brand; inside a
// restaurant the menu is shown in sections (burgers, chicken, fries…) taken from the product's category. Pure.

export interface Restaurant { key: string; brand: string; label: string; bg: string; fg: string; mark: string; lead?: string; logo?: string }

// each restaurant's own logo (its app icon or website icon); the colours and letters remain if a logo cannot load
export const RESTAURANTS: Restaurant[] = [
  { key: 'mcd', brand: "McDonald's", label: 'ماكدونالدز', bg: '#DA291C', fg: '#FFC72C', mark: 'M', logo: 'brands/mcd.webp' }, // i18n-ok: stored labels, shown via tMaybe
  { key: 'bk', brand: 'Burger King', label: 'برغر كنغ', bg: '#F5EBDC', fg: '#D62300', mark: 'BK', logo: 'brands/bk.webp' }, // i18n-ok
  { key: 'kfc', brand: 'KFC', label: 'كنتاكي', bg: '#E4002B', fg: '#FFFFFF', mark: 'KFC', logo: 'brands/kfc.webp' }, // i18n-ok
  { key: 'elevation', brand: 'Elevation Burger', label: 'إليفيشن برجر', bg: '#0B2D6E', fg: '#FFFFFF', mark: 'EB', logo: 'brands/elevation.webp' }, // i18n-ok
  { key: 'canes', brand: "Raising Cane's", label: 'كينز', bg: '#C8102E', fg: '#FFFFFF', mark: 'C', logo: 'brands/canes.webp' }, // i18n-ok
  { key: 'fiveguys', brand: 'Five Guys', label: 'فايف جايز', bg: '#D21033', fg: '#FFFFFF', mark: '5G', logo: 'brands/fiveguys.png' }, // i18n-ok
  { key: 'shakeshack', brand: 'Shake Shack', label: 'شيك شاك', bg: '#1F1F1F', fg: '#6CB33F', mark: 'SS', logo: 'brands/shakeshack.png' }, // i18n-ok
  { key: 'goodstuff', brand: 'Good Stuff', label: 'جود ستف', bg: '#1E6B3A', fg: '#F3EDE2', mark: 'GS' }, // i18n-ok
  { key: 'pick', brand: 'PICK', label: 'بيك', bg: '#722C80', fg: '#FFFFFF', mark: 'PICK', lead: 'frozen', logo: 'brands/pick.webp' }, // i18n-ok: frozen yogurt first
  { key: 'baskin', brand: 'Baskin Robbins', label: 'باسكن روبنز', bg: '#DA1884', fg: '#FFFFFF', mark: 'BR', lead: 'frozen', logo: 'brands/baskin.webp' }, // i18n-ok
];

export const restaurantOf = (brand: string | null | undefined): Restaurant | null =>
  RESTAURANTS.find((r) => r.brand.toLowerCase() === (brand ?? '').trim().toLowerCase()) ?? null;
export const restaurantByKey = (key: string | null | undefined) => RESTAURANTS.find((r) => r.key === key) ?? null;

export interface MenuSection { key: string; label: string; emoji: string; cats: string[] }
export const MENU_SECTIONS: MenuSection[] = [
  { key: 'meals', label: 'وجبات كاملة', emoji: '🍱', cats: ['وجبات'] }, // i18n-ok: combos (a whole meal as one item)
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

// ── cups by size: frozen yogurt is chosen size first, then flavour ─────────────────────────────────
export interface CupSize { key: string; label: string; emoji: string }
export const CUP_SIZES: CupSize[] = [
  { key: 'Mini cup', label: 'ميني', emoji: '🥄' }, // i18n-ok: stored labels, shown via tMaybe
  { key: 'Small cup', label: 'صغير', emoji: '🍦' }, // i18n-ok
  { key: 'Medium cup', label: 'وسط', emoji: '🍨' }, // i18n-ok
  { key: 'Large cup', label: 'كبير', emoji: '🍧' }, // i18n-ok
  { key: 'Regular parfait', label: 'بارفيه عادي', emoji: '🥛' }, // i18n-ok
  { key: 'Large parfait', label: 'بارفيه كبير', emoji: '🥛' }, // i18n-ok
];
const SIZED = /^(.+?)\s*\((Mini cup|Small cup|Medium cup|Large cup|Regular parfait|Large parfait)\)$/;

/** Items named "<flavour> (<size>)" gathered by size (only when two or more flavours share the sizes); `weighed`
 *  (sold by grams, no sizes) is no longer shown with the sizes: the family buys by size; the rest stay tiles. */
export function cupsOf<T extends { name: string; per_item?: boolean }>(items: T[]) {
  const sized = items.map((i) => ({ i, m: SIZED.exec(i.name) })).filter((x) => x.m);
  const flavours = new Set(sized.map((x) => x.m![1]));
  if (flavours.size < 2) return { sizes: [], weighed: [], rest: items };
  const sizes = CUP_SIZES.map((size) => ({ size, items: sized.filter((x) => x.m![2] === size.key).map((x) => ({ flavour: x.m![1], item: x.i })) })).filter((s) => s.items.length);
  const weighed = items.filter((i) => !SIZED.test(i.name) && !i.per_item);
  const rest = items.filter((i) => !SIZED.test(i.name) && i.per_item);
  return { sizes, weighed, rest };
}

// ── kids meals: built from the separate menu items (the meal itself has no nutrition of its own, so nothing is
// counted twice). Products are found by their exact stored name; a missing one is simply not offered. ──────────
export interface KidsMeal { key: string; label: string; main: string }
export interface KidsMealSet { title: string; meals: KidsMeal[]; sides: { label: string; name: string | null }[]; drinks: { label: string; name: string | null }[] }
/** Burger King Kuwait King Jr meals (menu checked 17 Oct 2026): main, small fries (the same item as on the menu)
 *  and a drink. Water first (the family's default), Coke Zero; orange juice has no reliable value yet. */
export const KIDS_MEALS: Record<string, KidsMealSet> = {
  bk: {
    title: 'وجبات كنغ جونيور', // i18n-ok: stored labels, shown via tMaybe
    meals: [
      { key: 'hamburger', label: 'هامبرغر', main: 'برجر كنج هامبرغر كيدز' }, // i18n-ok
      { key: 'cheeseburger', label: 'تشيز برجر', main: 'برجر كنج تشيز برجر كيدز' }, // i18n-ok
      { key: 'chicken', label: 'تشيكن برجر', main: 'برجر كنج تشيكن برجر كيدز' }, // i18n-ok
      { key: 'tenders', label: 'تندر ٤ قطع', main: 'برجر كنج تشيكن تيندر (4 قطع)' }, // i18n-ok
    ],
    sides: [{ label: 'بطاطا صغير', name: 'برجر كنج بطاطا (صغير)' }, { label: 'بدون', name: null }], // i18n-ok
    drinks: [{ label: 'ماي', name: 'برجر كنج ماء معدني' }, { label: 'كوك زيرو', name: 'برجر كنج كوك زيرو (علبة)' }, { label: 'بدون', name: null }], // i18n-ok
  },
};

/** The chosen parts of a kids meal as the product ids to put on the plate, each once (no meal row, no repeats).
 *  Null when the main is not in the food list. Pure. */
export function kidsMealIds(set: KidsMealSet, pick: { main: string; side: number; drink: number }, idOf: (name: string) => string | null): string[] | null {
  const meal = set.meals.find((m) => m.key === pick.main);
  const main = meal ? idOf(meal.main) : null;
  if (!main) return null;
  const parts = [main, set.sides[pick.side]?.name, set.drinks[pick.drink]?.name].map((n, i) => (i === 0 ? n : n ? idOf(n) : null)).filter((x): x is string => !!x);
  return [...new Set(parts)];
}
