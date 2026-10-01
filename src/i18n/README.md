# Translating the app (Arabic → English)

Arabic stays the source text. Wrap every user-visible Arabic string in `t()` from `src/i18n` and add its
English to the dictionary file for your area in `src/i18n/en/` (key = the exact Arabic string).

```tsx
import { t, dir, locale, isEn } from '../i18n';
<h2>{t('عرض السكر')}</h2>
toast(t('تم حفظ الإعدادات ✓'));
t('في {n} من {m} ليالٍ', { n: hits, m: nights })      // placeholders, never ${} inside t()
'{n} يوم': '{n} day|{n} days'                          // English plural: "one|many", chosen by params.n
```

Rules
- `t()` must be called at render time (inside components or functions), never at module top level: a constant
  like `const LABELS = { a: t('…') }` would freeze one language. Keep such tables in Arabic and call
  `t(LABELS[x])` where they are shown — and then the table line needs `// i18n-ok`, while every value still needs
  an English entry (add them to the dictionary; the check cannot see them, so double-check).
- Lookup tables of labels: wrap with `tr({...})` (values are translated when read) and mark the line(s)
  `// i18n-ok`; every value still needs an English entry.
- No template literals in `t()`. Use `{name}` placeholders; the English must use the same placeholder names.
- Rich text: split around markup, `{t('ضمن النطاق')} <b>{x}</b>`, and write the English fragments so they still
  read naturally in English order. Reorder JSX with `isEn()` only when a sentence truly cannot be split.
- `dir="rtl"` on an element → `dir={dir()}`. `dir="ltr"` on numbers, graphs, emails stays.
  Canvas: `g.direction = dir()`. Tailwind: use logical classes (`ms-`, `me-`, `ps-`, `start-`, `text-start`);
  replace `text-right`/`left-`/`right-` that mean "start/end".
- Arrows/chevrons that point "back" or "forward" (‹ ›, ←) must flip: `{isEn() ? '›' : '‹'}`.
- Dates and times: `toLocale…String(locale(), …)`; Arabic month/weekday arrays need English twins.
- User data (product, recipe, member names, notes) is never translated. Known category names may be shown with
  `tMaybe(category)`.
- Medical wording: keep the meaning exact. Never turn a description into advice. Units: mmol/L, mg/dL,
  g, min (“د” → “min”, “س” → “h”), U for insulin units (“وحدة” → “U”/“units”).
- English tone: short, plain, warm, sentence case. “ليان” → “Layan”. “الآن” (tab) → “Now”.
- A line that must keep Arabic gets `// i18n-ok`. The check still requires English for every Arabic string on
  it (label tables), unless the comment says why it is data: `// i18n-ok: data …` or `// i18n-ok: stored …`.
- Check your files: `npx tsx scripts/i18n-report.ts src/pages/YourFile.tsx …` must print `clean`, and
  `npx tsc --noEmit -p .` must pass.
