// Brands: written the way the family typed them, but "kdd", "KDD " and "KDD" are one brand.
export const normBrand = (b: string | null | undefined): string | null => {
  const s = (b ?? '').replace(/\s+/g, ' ').trim();
  return s ? s : null;
};
export const sameBrand = (a: string | null | undefined, b: string | null | undefined) => (normBrand(a) ?? '').toLowerCase() === (normBrand(b) ?? '').toLowerCase();

/** The brands in use, most used first, one spelling each (the most common one). */
export function brandsOf(rows: { brand: string | null; uses?: number }[]): string[] {
  const by = new Map<string, { name: string; uses: number; spell: Map<string, number> }>();
  for (const r of rows) {
    const b = normBrand(r.brand); if (!b) continue;
    const k = b.toLowerCase(), e = by.get(k) ?? { name: b, uses: 0, spell: new Map() };
    e.uses += r.uses ?? 1; e.spell.set(b, (e.spell.get(b) ?? 0) + 1); by.set(k, e);
  }
  return [...by.values()].map((e) => ({ uses: e.uses, name: [...e.spell.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)).map((e) => e.name);
}
