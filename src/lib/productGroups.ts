// Product groups: the product categories gathered into a few groups (dairy, drinks…) so a brand with many products,
// like KDD, can be browsed by group, then by type within the group. Pure, tested in Node.

export interface ProductGroup { key: string; label: string; emoji: string; cats: string[] }

export const PRODUCT_GROUPS: ProductGroup[] = [
  { key: 'veg', label: 'خضار', emoji: '🥕', cats: ['خضار', 'ملوخية', 'بطاط مجمد'] }, // i18n-ok: stored values
  { key: 'fruit', label: 'فواكه', emoji: '🍎', cats: ['فواكه'] }, // i18n-ok: stored values
  { key: 'nuts', label: 'مكسرات', emoji: '🥜', cats: ['مكسرات'] }, // i18n-ok: stored values
  { key: 'protein', label: 'لحوم وبروتين', emoji: '🍗', cats: ['لحوم ودجاج', 'سمك وروبيان', 'بيض', 'ناجت', 'برغر لحم'] }, // i18n-ok: stored values
  { key: 'rice', label: 'رز', emoji: '🍚', cats: ['رز'] }, // i18n-ok: stored values
  { key: 'bread', label: 'خبز ونشويات', emoji: '🍞', cats: ['خبز', 'توست', 'صمون', 'معجنات', 'سندويشات', 'نشويات', 'طحين'] }, // i18n-ok: stored values
  { key: 'pasta', label: 'معكرونة', emoji: '🍝', cats: ['باستا'] }, // i18n-ok: stored values
  { key: 'grains', label: 'حبوب وبقوليات', emoji: '🫘', cats: ['حبوب وبقوليات'] }, // i18n-ok: stored values
  { key: 'dairy', label: 'ألبان', emoji: '🥛', cats: ['حليب', 'لبن', 'روب', 'جبن', 'كريمة طبخ'] }, // i18n-ok: stored values
  { key: 'drinks', label: 'عصائر ومشروبات', emoji: '🧃', cats: ['عصير طبيعي', 'مشروبات'] }, // i18n-ok: stored values
  { key: 'breakfast', label: 'فطور', emoji: '🥣', cats: ['حبوب الإفطار', 'فطور'] }, // i18n-ok: stored values
  { key: 'sauces', label: 'صلصات وإضافات', emoji: '🍯', cats: ['صلصة', 'كاتشب', 'مايونيز', 'سكر وعسل'] }, // i18n-ok: stored values
  { key: 'sweets', label: 'حلويات وسناكات', emoji: '🍫', cats: ['حلويات', 'بسكويت', 'كيك', 'آيس كريم', 'شوكولاتة', 'سناكات'] }, // i18n-ok: stored values
];
const OTHER: ProductGroup = { key: 'other', label: 'أخرى', emoji: '🍽️', cats: [] }; // i18n-ok: stored value

export const groupOf = (category: string | null | undefined): ProductGroup =>
  PRODUCT_GROUPS.find((g) => !!category && g.cats.includes(category)) ?? OTHER;

/** A group by its key (other included); null for an unknown key. */
export const groupByKey = (key: string | null | undefined): ProductGroup | null => [...PRODUCT_GROUPS, OTHER].find((g) => g.key === key) ?? null;

/** The groups these products fall in, in the fixed order (other last), each with how many products it holds. */
export function groupsIn(products: { category: string | null }[]): { group: ProductGroup; n: number }[] {
  const n = new Map<string, number>();
  for (const p of products) { const k = groupOf(p.category).key; n.set(k, (n.get(k) ?? 0) + 1); }
  return [...PRODUCT_GROUPS, OTHER].filter((g) => n.has(g.key)).map((g) => ({ group: g, n: n.get(g.key)! }));
}

/** The types (categories) inside one group among these products, with counts, most first. */
export function typesIn(products: { category: string | null }[], key: string): { cat: string; n: number }[] {
  const n = new Map<string, number>();
  for (const p of products) if (p.category && groupOf(p.category).key === key) n.set(p.category, (n.get(p.category) ?? 0) + 1);
  return [...n].map(([cat, k]) => ({ cat, n: k })).sort((a, b) => b.n - a.n || a.cat.localeCompare(b.cat));
}
