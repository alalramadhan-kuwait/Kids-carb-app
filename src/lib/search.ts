// Search that forgives how a word was typed: case, Arabic letter forms (أ إ آ → ا, ة → ه, ى → ي) and diacritics.
// Every word typed must appear somewhere in the item's text. Pure, tested in Node.

export const norm = (s: string) => s.toLowerCase()
  .replace(/[ً-ْـ]/g, '') // i18n-ok: regex (diacritics, tatweel, letter forms)
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي') // i18n-ok: regex (diacritics, tatweel, letter forms)
  .replace(/\s+/g, ' ').trim();

export function matches(hay: (string | null | undefined)[], query: string): boolean {
  const h = norm(hay.filter(Boolean).join(' '));
  return norm(query).split(' ').filter(Boolean).every((w) => h.includes(w));
}
