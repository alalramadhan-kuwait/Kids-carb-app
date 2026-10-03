// Product groups: the product categories gathered into a few groups (dairy, drinks…) so a brand with many products,
// like KDD, can be browsed by group, then by type within the group. Pure, tested in Node.

export interface ProductGroup { key: string; label: string; emoji: string; cats: string[] }

export const PRODUCT_GROUPS: ProductGroup[] = [
  { key: 'dairy', label: 'ألبان', emoji: '🥛', cats: ['حليب', 'لبن', 'روب', 'جبن', 'كريمة طبخ'] }, // i18n-ok: stored values
  { key: 'drinks', label: 'مشروبات', emoji: '🧃', cats: ['مشروبات'] }, // i18n-ok: stored values
  { key: 'sweets', label: 'حلويات وآيس كريم', emoji: '🍦', cats: ['حلويات', 'آيس كريم'] }, // i18n-ok: stored values
  { key: 'starch', label: 'نشويات وخبز', emoji: '🍞', cats: ['توست', 'صمون', 'نشويات', 'باستا', 'بطاط مجمد'] }, // i18n-ok: stored values
  { key: 'protein', label: 'لحوم ودجاج وبيض', emoji: '🍗', cats: ['لحوم ودجاج', 'ناجت', 'برغر لحم', 'بيض'] }, // i18n-ok: stored values
  { key: 'produce', label: 'فواكه وخضار', emoji: '🍎', cats: ['فواكه', 'خضار', 'ملوخية'] }, // i18n-ok: stored values
  { key: 'sauces', label: 'صلصات', emoji: '🥫', cats: ['صلصة', 'كاتشب', 'مايونيز'] }, // i18n-ok: stored values
];
const OTHER: ProductGroup = { key: 'other', label: 'أخرى', emoji: '🍽️', cats: [] }; // i18n-ok: stored value

export const groupOf = (category: string | null | undefined): ProductGroup =>
  PRODUCT_GROUPS.find((g) => !!category && g.cats.includes(category)) ?? OTHER;

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
