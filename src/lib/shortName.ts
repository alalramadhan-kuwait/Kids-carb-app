// A short label for a food on a small card (frequent foods): what tells items apart, nothing else. The full name
// stays everywhere else (the toast, History, Products). Pure, tested in Node.
//   "1.2.3 Full Cream Milk (Kids) 125ml"                → "1.2.3 Milk 125ml"
//   "Apple Juice 1 LTR (كوب 200 مل)"                    → "Apple Juice 200ml"   (the carbs are for the cup)
//   "Mojito (lemon & mint) Beverage (0% Sugar) 250ml"  → "Mojito 250ml"        (the carbs show the 0)

const UNIT: Record<string, string> = { 'مل': 'ml', ml: 'ml', 'غ': 'g', g: 'g' }; // i18n-ok: data, units as printed

export function shortName(name: string): string {
  let s = name;
  // a serving in brackets ("(كوب 200 مل)") is what the carbs are for: it replaces the pack size
  let serve = '';
  s = s.replace(/\((?:كوب|cup)\s*(\d+(?:\.\d+)?)\s*(مل|ml|غ|g)\)/gi, (_m, n: string, u: string) => { serve = n + UNIT[u.toLowerCase()]; return ' '; }); // i18n-ok: data
  if (serve) s = s.replace(/\b\d+(?:\.\d+)?\s*(?:ltr|litre|liter|l)\b/gi, ' ');
  // notes in brackets: kids, sugar, calories, flavours ("(lemon & mint)"), "(ملصق)"; a bracket with a size stays
  s = s.replace(/\(([^)]*)\)/g, (m, inner: string) => (/sugar|kids|&|ملصق|سعرة|kcal|calorie/i.test(inner) || !/\d/.test(inner) ? ' ' : m)); // i18n-ok: data
  s = s
    .replace(/lactose\s*free\s*-?\s*/i, 'Lactose-free ')
    .replace(/full\s+cream\s+milk/i, 'Milk')
    .replace(/ice\s+cream\s+cups?/i, 'Ice Cream')
    .replace(/\b(?:premium|beverage)\b/gi, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*(?:ml)\b/gi, '$1ml')
    .replace(/(\d+(?:\.\d+)?)\s*(?:ltr|litre|liter)\b/gi, '$1L');
  s = (s + (serve ? ' ' + serve : '')).replace(/\s+-\s+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return s.length >= 3 ? s : name;
}
