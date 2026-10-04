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

/* ------------------------------------------------------------ sub-groups: one more level inside each group */

export interface SubGroup { key: string; label: string; emoji: string; cats?: string[]; words?: string[] }
type P = { name: string; category: string | null; kind?: string | null };
const low = (s: string) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه'); // i18n-ok: regex (letter forms)
/** Inside a group, the first sub-group whose category or name word matches; the last one of each list takes the rest. */
export const SUB_GROUPS: Record<string, SubGroup[]> = { // i18n-ok: stored labels and search words, shown via tMaybe
  veg: [
    { key: 'starchy', label: 'بطاط وذرة وبازلاء', emoji: '🥔', cats: ['بطاط مجمد'], words: ['بطاط', 'بطاطا', 'ذره', 'بازلاء', 'فرايز', 'potato', 'corn', 'peas', 'fries'] }, // i18n-ok: stored values
    { key: 'salad', label: 'سلطة وخضار نيئة', emoji: '🥗', words: ['سلطه', 'salad', 'خيار', 'طماط', 'خس', 'ملفوف', 'فلفل', 'جزر نيء', 'بصل', 'نيء'] }, // i18n-ok: stored values
    { key: 'cooked', label: 'خضار مطبوخة', emoji: '🥦' }, // i18n-ok: stored values
  ],
  fruit: [
    { key: 'dried', label: 'تمر وفواكه مجففة', emoji: '🌴', words: ['تمر', 'زبيب', 'مجفف', 'dates', 'raisin'] }, // i18n-ok: stored values
    { key: 'fresh', label: 'فواكه طازجة', emoji: '🍎' }, // i18n-ok: stored values
  ],
  protein: [
    { key: 'fish', label: 'سمك وروبيان', emoji: '🐟', cats: ['سمك وروبيان'] }, // i18n-ok: stored values
    { key: 'eggs', label: 'بيض', emoji: '🥚', cats: ['بيض'] }, // i18n-ok: stored values
    { key: 'chicken', label: 'دجاج وديك رومي', emoji: '🍗', cats: ['ناجت'], words: ['دجاج', 'ناجت', 'ديك رومي', 'تركي', 'chicken', 'nugget', 'turkey'] }, // i18n-ok: stored values
    { key: 'meat', label: 'لحم', emoji: '🥩' }, // i18n-ok: stored values
  ],
  rice: [
    { key: 'brown', label: 'رز بني وبري', emoji: '🌾', words: ['بني', 'بري', 'brown', 'wild'] }, // i18n-ok: stored values
    { key: 'white', label: 'رز أبيض', emoji: '🍚' }, // i18n-ok: stored values
  ],
  bread: [
    { key: 'toast', label: 'توست', emoji: '🍞', cats: ['توست'], words: ['توست', 'toast', 'sliced bread'] }, // i18n-ok: stored values
    { key: 'arabic', label: 'خبز عربي وتورتيا', emoji: '🫓', words: ['عربي', 'تورتيا', 'رقاق', 'شابوره', 'tortilla', 'wrap', 'arabic', 'rugag', 'shaboura', 'pita'] }, // i18n-ok: stored values
    { key: 'rolls', label: 'صمون وبرغر', emoji: '🥖', cats: ['صمون'], words: ['صمون', 'برغر', 'هوت دوغ', 'roll', 'bun', 'burger', 'hot dog', 'hamburger', 'slider'] }, // i18n-ok: stored values
    { key: 'pastry', label: 'معجنات وكرواسون', emoji: '🥐', cats: ['معجنات'], words: ['كرواسون', 'بيغل', 'croissant', 'bagel', 'pizza'] }, // i18n-ok: stored values
    { key: 'sandwich', label: 'سندويشات', emoji: '🥪', cats: ['سندويشات'] }, // i18n-ok: stored values
    { key: 'flour', label: 'طحين', emoji: '🌾', cats: ['طحين'] }, // i18n-ok: stored values
    { key: 'loaf', label: 'خبز', emoji: '🍞', words: ['خبز', 'bread', 'ciabatta'] }, // i18n-ok: stored values
    { key: 'other', label: 'فرايز ونشويات ثانية', emoji: '🍟' }, // i18n-ok: stored values // i18n-ok: stored values
  ],
  pasta: [
    { key: 'cooked', label: 'معكرونة مطبوخة', emoji: '🍝', words: ['مطبوخ'] }, // i18n-ok: stored values
    { key: 'dry', label: 'معكرونة جافة (للوزن)', emoji: '📦' }, // i18n-ok: stored values
  ],
  grains: [
    { key: 'legumes', label: 'بقوليات', emoji: '🫘', words: ['عدس', 'حمص', 'فاصوليا', 'فول', 'ماش', 'lentil', 'chickpea', 'bean', 'hummus'] }, // i18n-ok: stored values
    { key: 'grains', label: 'شوفان وحبوب', emoji: '🌾' }, // i18n-ok: stored values
  ],
  dairy: [
    { key: 'milk', label: 'حليب', emoji: '🥛', cats: ['حليب'], words: ['milk', 'حليب'] }, // i18n-ok: stored values
    { key: 'laban', label: 'لبن وروب', emoji: '🥣', cats: ['لبن', 'روب'] }, // i18n-ok: stored values
    { key: 'cheese', label: 'جبن ولبنة', emoji: '🧀', cats: ['جبن'] }, // i18n-ok: stored values
    { key: 'cream', label: 'قشطة وكريمة', emoji: '🍶' }, // i18n-ok: stored values
  ],
  drinks: [
    { key: 'juice', label: 'عصير طبيعي', emoji: '🍊', cats: ['عصير طبيعي'] }, // i18n-ok: stored values
    { key: 'other', label: 'عصائر ومشروبات معلبة', emoji: '🧃' }, // i18n-ok: stored values
  ],
  breakfast: [
    { key: 'cereal', label: 'حبوب الإفطار', emoji: '🥣', cats: ['حبوب الإفطار'] }, // i18n-ok: stored values
    { key: 'other', label: 'بان كيك ووافل', emoji: '🥞' }, // i18n-ok: stored values
  ],
  sauces: [
    { key: 'sweet', label: 'سكر وعسل ومربى', emoji: '🍯', cats: ['سكر وعسل'] }, // i18n-ok: stored values
    { key: 'fats', label: 'زيوت وسمن', emoji: '🫒', words: ['زيت', 'سمن', 'زبده', 'oil', 'ghee', 'butter'] }, // i18n-ok: stored values
    { key: 'sauce', label: 'صلصات', emoji: '🥫' }, // i18n-ok: stored values
  ],
  sweets: [
    { key: 'biscuits', label: 'بسكويت', emoji: '🍪', cats: ['بسكويت'] }, // i18n-ok: stored values
    { key: 'cake', label: 'كيك', emoji: '🍰', cats: ['كيك'] }, // i18n-ok: stored values
    { key: 'icecream', label: 'آيس كريم', emoji: '🍦', cats: ['آيس كريم'] }, // i18n-ok: stored values
    { key: 'chocolate', label: 'شوكولاتة', emoji: '🍫', cats: ['شوكولاتة'] }, // i18n-ok: stored values
    { key: 'snacks', label: 'شيبس وسناكات', emoji: '🍿', cats: ['سناكات'] }, // i18n-ok: stored values
    { key: 'sweets', label: 'حلويات', emoji: '🍬' }, // i18n-ok: stored values
  ],
};

/** The sub-group a product falls in inside its group (null when the group has no sub-groups). */
export function subgroupOf(p: P): SubGroup | null {
  const list = SUB_GROUPS[groupOf(p.category).key];
  if (!list) return null;
  const name = low(p.name);
  return list.find((s) => (s.cats?.includes(p.category ?? '') ?? false) || (s.words ?? []).some((w) => name.includes(low(w)))) ?? list[list.length - 1];
}

/** The sub-groups that hold these products (already of one group), in order, with counts. */
export function subgroupsIn(products: P[], key: string): { sub: SubGroup; n: number }[] {
  const list = SUB_GROUPS[key] ?? [];
  const n = new Map<string, number>();
  for (const p of products) { const s = subgroupOf(p); if (s) n.set(s.key, (n.get(s.key) ?? 0) + 1); }
  return list.filter((s) => n.has(s.key)).map((s) => ({ sub: s, n: n.get(s.key)! }));
}
