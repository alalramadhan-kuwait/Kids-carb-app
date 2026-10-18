// Where a food's carb number comes from, read from what is already stored with it (its notes), so no record needs
// rewriting: an AI photo estimate the mother checked («تقريبي»), her own reading of a label («قراءة ماما»), or a
// restaurant's value from another country or a reference table («مرجعي»). Everything else (Dad's labels, official
// sites, the food tables) carries no tag. The tag is shown with the food on every screen; it never changes a number.
export type CarbSource = 'estimate' | 'mom_label' | 'reference';

export function carbSource(p: { notes?: string | null } | null | undefined): CarbSource | null {
  const n = (p?.notes ?? '').trim();
  if (!n) return null;
  if (n.startsWith('من صورة (تقدير)')) return 'estimate'; // i18n-ok: stored note (MomSnap)
  if (n.startsWith('من ماما: الكارب من الملصق')) return 'mom_label'; // i18n-ok: stored note (saveLabelFood)
  if (/مرجعي|غير مؤكدة|reference value/i.test(n)) return 'reference'; // i18n-ok: stored notes
  return null;
}

/** The tag's words, Arabic first (the screens pass them through t()). */
export const SOURCE_WORD: Record<CarbSource, string> = { estimate: 'تقريبي', mom_label: 'قراءة ماما', reference: 'مرجعي' }; // i18n-ok: keys, shown via t()

/** The tags of a whole plate, once each, most uncertain first (for the dose page's one line). */
export function plateSources(list: (CarbSource | null | undefined)[]): CarbSource[] {
  const order: CarbSource[] = ['estimate', 'reference', 'mom_label'];
  return order.filter((s) => list.includes(s));
}
