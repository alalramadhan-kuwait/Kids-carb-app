# Layan — Design System

The fixed visual rules for this app. Any developer or AI continuing the app follows this file; it wins over
taste. Medical clarity wins over everything in it.

**The rule behind every screen:** 80% clean healthcare interface, 20% Layan personality. Layan makes it
*her* app; she never makes glucose, insulin, carbs, trends or alerts harder to read.

---

## 1. Direction

Soft, warm, child-friendly healthcare: rounded cards, generous white space, soft pastel backgrounds, simple
icons, Layan illustrations for personality, and almost no decoration on data screens.

Never: gradients or glows behind glucose numbers · decorative colour that looks like a medical status ·
thin text · cartoon fonts for data · Layan's face used to signal a medical state.

---

## 2. Brand colours (light) — "Option 1, lavender" (approved; replaces the plum palette of v0.10)

Approved mockup: warm off-white background, white cards with a very thin soft-purple border, lavender brand
colour, deep indigo text. Layan peeks from behind the glucose card on الآن and gives the personality; the rest
of the interface stays clean. Medical colours (§4) are unchanged and reserved.

| Token | HEX | Use |
|---|---|---|
| `--bg` | `#FCF7F8` | App background (warm off-white) |
| `--surface` | `#FFFDFD` | Cards, sheets, tab bar |
| `--surface-2` | `#F4EFFD` | Graph plot area, inputs, inactive chips, ghost buttons |
| `--border` | `#E4DCF9` | The thin soft-purple card border, dividers, inputs |
| `--primary` | `#8A6DF2` | Glucose line, progress fill — graphics only, not text (3.4:1 on the plot area) |
| `--primary-strong` | `#5B48D6` | **Buttons, links, selected tab, any text in brand colour** (white on it 6.2:1) |
| `--primary-soft` | `#E9E0FD` | Selected tab pill, soft buttons, chips |
| `--primary-muted` | `#D6CBFD` | Icon circles in lists, checklist circles |
| `--num` | `#302286` | The glucose number and key figures |
| `--text` | `#261E5C` | Main text (deep indigo) |
| `--text-2` | `#625A87` | Secondary text |
| `--text-3` | `#9084A9` | Axis labels and hints only |
| `--accent` | `#F49AB6` | The few hearts around Layan only (pink rule) |

**Pink rule.** Pink is close to Low red: only the faint hearts beside Layan, never near a glucose value, a
status chip, a graph or an alert.

**Layan rule.** One illustration layer (`public/assets/09_brand/layan_peek.webp`, transparent), peeking over
the glucose card on الآن only, with at most four faint hearts around her. No decoration anywhere else.

## 3. Night colours (dark) — same lavender identity

| Token | HEX |
|---|---|
| `--bg` | `#2D2637` |
| `--surface` | `#352E43` |
| `--surface-2` | `#423A5A` |
| `--border` | `#4E446C` |
| `--primary` | `#C1A6F3` |
| `--primary-strong` | `#C4B0FA` (text on it: `#352E43`) |
| `--primary-soft` | `#4A3E6D` |
| `--primary-muted` | `#7C67A8` |
| `--num` | `#DBCDFA` |
| `--text` / `--text-2` / `--text-3` | `#F5F2FB` / `#C8BEDE` / `#968CB2` |

---

## 4. Medical colours — a separate system

These colours mean something. They are never used for decoration, branding or illustrations.

| Status | Range (mg/dL · mmol/L) | Fill / dot | Text on light | Soft background | Night fill / text |
|---|---|---|---|---|---|
| Urgent low | < 54 · < 3.0 | `#C83E4D` | `#A82F3D` | `#F7DADD` | `#FF5A68` |
| Low | 54–69 · 3.0–3.8 | `#E95F68` | `#B83A44` | `#FCE6E8` | `#FF7A83` |
| In range | 70–180 · 3.9–10.0 | `#46B98A` | `#1F7A55` | `#E3F5EC` | `#5FD3A2` |
| High | 181–250 · 10.1–13.9 | `#F2A541` | `#8F5A00` | `#FDF1DC` | `#F5B65A` |
| Very high | > 250 · > 13.9 | `#D9822B` | `#8A4A0F` | `#FBE9D8` | `#F0954A` |
| Information | — | `#519AD4` | `#2C6FA6` | `#E4F0FA` | `#7CB8E8` |

The ranges above are the international *reporting* bands used for Time in Range. Her personal target and
every alert threshold are set by the parents in Settings; status colours follow those parent values on the
live screen. Until the parents enter her range, the reporting range 70–180 (3.9–10.0) is used for colours and
status, drawn dashed and labelled «مرجعي» (parents' decision, 1 Oct 2026). Alerts never fall back to it.

**Fill vs text.** The fill colours (`#46B98A`, `#F2A541`, `#E95F68`) are too light for text on white
(2.5:1, 2.1:1, 3.3:1). Use them for dots, bars, graph bands and chip backgrounds. Any *word* in a medical
colour uses the "Text on light" column.

**Never colour alone.** A status is always number + arrow + words. Example:

```
6.4 →  mmol/L   ● In range · steady      (green dot, green-text label)
3.4 ↘  mmol/L   ● Low · falling          (red dot, red-text label)
```

The glucose number itself stays in `--text`. The status is carried by the chip next to it. This keeps the
number readable in every state and on every background.

---

## 5. Background hierarchy

1. App background: `--bg` (cream; night indigo).
2. Cards: `--surface` (white).
3. Selected controls: `--primary-soft`, or `--accent-soft` / Powder Blue on non-medical screens.
4. **The glucose card is the cleanest thing on the screen.** Plain `--surface`, no illustration, pattern,
   sticker, flower, star or character inside it or directly behind it.

---

## 6. Typography

One family for Arabic, Latin and digits: **Rubik** (rounded, warm, clear numerals), bundled with the app
(`@fontsource/rubik`, weights 400–700) so it works offline and does not depend on Google Fonts.

| Use | Size / weight |
|---|---|
| Glucose on Home | **64 px / 700** |
| Glucose in Night mode | **96 px / 700** |
| Glucose in Analysis | 48 px / 700 |
| Screen title | 26 px / 700 |
| Card title | 18 px / 600 |
| Body | 16 px / 400, line-height 1.6 |
| Secondary | 14 px / 400 |
| Caption (minimum size) | 12 px / 500 |

Numbers use tabular figures and are isolated left-to-right (`.num`). Digits are Western (0–9).

**Units and words are Arabic** on every screen: مليمول/ل · ملغ/دل · د (minutes) · غ (grams) · و (units, rail
labels only). Changes are words, not signs: «نزل 0.7 خلال 15 د», never «−0.7 / 15 min» — a minus sign next
to Arabic text is easy to misread. Product names stay as printed on the label.

Fallback stack: `Rubik, system-ui, -apple-system, "Segoe UI", sans-serif`.

---

## 7. Shape, spacing, elevation

| Element | Radius |
|---|---|
| Cards | 22 px |
| Buttons | 16 px |
| Inputs | 14 px |
| Chips / tags | pill (999 px) |
| Icon containers | circle, or 14 px rounded square |
| Bottom sheets | 24 px top corners |

- Spacing scale (px): 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40. Screen side gutter 16. Gap between cards 12.
- Touch targets at least 44 × 44 px. Primary actions 52 px tall.
- One shadow only, for cards on light: `0 2px 10px rgba(48, 43, 43, 0.06)`. No shadows at night.
- No sharp corners anywhere.

---

## 8. Icons

- One family: soft rounded line icons, 24 px grid, 2 px stroke, round caps and joins, minimal inner detail.
- Delivered as **SVG** using `currentColor`, so they recolour for night mode and selected states.
- Navigation icons are neutral (`--text-2`), `--primary-strong` when selected.
- Medical status colours only when the icon *is* that status (e.g. the dot on a Low chip).
- **Status icons have no faces.** A drop plus an arrow, nothing else.
- Do not mix 3D, glossy, line and cartoon icons. The soft-3D navigation icons in the first asset sheet are
  replaced by flat line icons in the same rounded style.

### Bottom navigation (5 tabs)

| Tab | Icon file |
|---|---|
| الآن | `ic_home.svg` |
| السجل | `ic_history.svg` |
| الوجبات | `ic_meal.svg` |
| متقدم | `ic_reports.svg` (calculations, patterns, suggestions, reports) |
| المزيد | `ic_settings.svg` |

The glucose, insulin, activity and note icons appear inside the "سجّل" (Log) sheet, not in the tab bar.

---

## 9. Layan illustrations

### Where she appears
Home (beside, never inside, the glucose card) · onboarding · empty states · completed-log moments ·
education and tips · meals and recipes · school mode · exercise · bedtime / night summary.

### Where she does not appear
Glucose graphs · alerts · insulin entries list · history tables · reports · the Advanced tab ·
any screen showing an urgent state.

### Emotions are for non-medical moments only

| Asset | Use | Never use for |
|---|---|---|
| `layan_emotion_happy` | Log saved, onboarding finished | "Glucose is good" |
| `layan_emotion_cheer` | Streak of logging days | Rewarding a glucose result |
| `layan_emotion_love` | Welcome, family added | — |
| `layan_emotion_wink` | Small confirmations | — |
| `layan_emotion_thinking` | Empty states, questions | — |
| `layan_emotion_idea` | Tips, education | — |
| `layan_emotion_calm` | Night summary background panel, settings done | — |
| `layan_emotion_sad` | Sick-day note, connection problem ("can't reach the sensor") | Low or high glucose |
| `layan_emotion_worried` | Not used on medical screens | High glucose, alerts |
| `layan_emotion_angry` | **Not used** | Anything — an angry face on an alert reads as blame |

Rewards and achievements are for habits (logging meals, checking in, finishing setup), never for glucose
numbers, Time in Range, or "good days".

### Asset map (examples)

| Asset | Screen |
|---|---|
| `layan_activity_eat` | Meal logging, empty meals list |
| `layan_activity_insulin` | Insulin log sheet header (small) |
| `layan_activity_check` | CGM connection setup |
| `layan_activity_sleep` | Night mode setup, morning summary |
| `layan_activity_run` | Activity log |
| `layan_activity_study` | School mode |
| `layan_outfit_school` | School mode header |
| `layan_outfit_pajama` | Bedtime / night schedule |
| `layan_outfit_cook` | Recipes, add recipe |
| `layan_outfit_casual` | Home greeting, onboarding |

### Character consistency (check every new asset)
- Same face proportions, large dark-brown eyes, dark-brown long hair, same warm skin tone.
- **The periwinkle floral bow is always present and always periwinkle** (the first sheet's sport and summer
  outfits show a pink bow — regenerate those).
- Outfits may change with context; the face and bow never do.
- Same soft watercolour style, same light direction, no outlines thicker than the rest of the set.

---

## 10. Assets — folders, names, formats

Deployed assets live in `public/assets/`. Master files (2048 px PNG) stay **outside the public repository**.

| Folder | Content | Deliver as | Sizes |
|---|---|---|---|
| `01_outfits/` | Full-body poses | WebP, transparent | 1024 and 512 px |
| `02_emotions/` | Head-and-shoulders | WebP, transparent | 512 and 256 px |
| `03_activities/` | Activity scenes | WebP, transparent | 1024 and 512 px |
| `04_objects/` | CGM, meter, pen, strip, lancet, hypo treatment | WebP, transparent | 256 px |
| `05_food/` | Reusable food | WebP, transparent | 256 px |
| `06_navigation/` | UI icons | **SVG**, `currentColor` | 24 px grid |
| `07_status/` | Status and trend symbols | **SVG** | 24 px grid |
| `08_decorations/` | Bow, heart, flower, star, bunny, sparkle | SVG or WebP | 128 px |
| `09_brand/` | App icon, splash, logo | PNG | see below |

**Naming:** lowercase `snake_case`, folder prefix, size suffix for raster files:
`layan_emotion_happy_512.webp`, `food_rice_256.webp`, `ic_meal.svg`, `st_trend_falling.svg`.

**Weight budget:** each illustration ≤ 120 KB, each icon ≤ 3 KB. Load illustrations lazily; never block the
glucose card on an image.

**Brand files**
- App icon: 1024 px master; export 512, 192, maskable 512 (safe zone 80%), Apple touch 180. Layan's face and
  bow only, **no text** (unreadable at home-screen size; the name shows under the icon).
- Splash: 1290 × 2796 portrait, illustration centred in the top 60%.
- Logo: icon mark + wordmark version for onboarding.

### Asset pack 04–09 (received 2026-10-01) — what is used

| Pack folder | Stored in | Used for |
|---|---|---|
| 04_Brand | `09_brand/` | `brand_heart_bow.svg` as a small mark; the raster app icon is the main brand image |
| 05_Navigation | `06_navigation/pack/` | Reference only. The app uses its own `ic_*` set (currentColor, day/night). The pack's glucose drop is pink, which breaks the pink rule |
| 06_Diabetes_Objects | `04_objects/` | CGM connection card and setup page; later the Log sheet |
| 07_Food | `05_food/` | Placeholder art for recipes (`food_meal`, `food_cereal` for breakfast) and snacks (`food_snack`, `food_juice`) |
| 08_Status | `07_status/pack/` | **Not used.** High/low carry ↑/↓, the same arrows that mean "rising/falling fast"; a "High" chip next to a "falling" arrow would contradict itself. The faceless drops (`st_*`) stay |
| 09_Decorations | `08_decorations/` | Sign-in, onboarding and celebration screens only |

App icon: `public/icons/` — full-bleed 180 px Apple icon and 192/512 px icons (corners filled with the icon's own pink so
iOS shows no black corners), a maskable 512 px with the whole artwork inside the safe zone, and the original rounded art
as `layan-logo-256/512.webp` for the sign-in screen. The icon keeps the name «ليان» by the family's choice.

---

## 11. Components

**Glucose card** — plain surface; number (64 px, `--text`) · unit · arrow · status chip (dot + words in
medical text colour) · age ("2 min ago"). Older than 10 min: number at 50% opacity and "Not recent". Older
than 20 min: the big number is replaced by "No recent reading" and the last value shown small.

**Graph** — target band in in-range soft colour, line in `--primary-strong`, threshold lines dashed in the
medical fill colours, event markers as small neutral icons (meal, insulin, treatment, note), gaps drawn as
breaks, never joined. No illustrations, no gradients under the line.

**Status chip** — pill, soft background + dot + label in the medical text colour.

**Primary button** — `--primary-strong` fill, white text, 16 px radius, 52 px tall.
**Secondary button** — `--primary-soft` fill, `--primary-strong` text.
**Danger confirmation** — white fill, `#B83A44` text and border; never Layan Pink.

**Alert banner** — medical soft background, dot, plain sentence, care-plan link, "I'm on it" button. No
illustration, no decoration.

---

## 12. Accessibility

- Text contrast at least 4.5:1, large text (≥ 24 px bold) at least 3:1. Every text/background pair in sections 2–4
  was checked against white, cream and its own soft background (light) and surface/soft (night).
- Status never by colour alone (number + arrow + words).
- Respect the phone's text size; layouts must survive 130% text.
- Respect reduced motion: no animated glucose numbers, no confetti on medical screens.
- Arabic first (RTL); numbers and units stay left-to-right inside RTL text.

---

## 12b. UX laws — how every screen is judged

Seven usability laws, each turned into a rule for this app. They decide *how it works*; the sections above
decide *how it looks*.

| Law | Rule in this app | Where it shows |
|---|---|---|
| **Fitts's Law** — big, close targets are faster to hit | Primary actions ≥ 52 px tall and within the thumb zone (bottom third). "سجّل" is a fixed button above the tab bar. In an alert, "أنا عليها" spans the full width. Destructive actions are small and far from primary ones. | Home, Log sheet, alerts |
| **Hick's Law** — more choices, slower decisions | Max 5 tabs, max 3 meal suggestions, max 4 options in the Log sheet. Everything analytical lives in متقدم. Long forms show the essential fields; the rest open under "تفاصيل أكثر". | Tabs, Log sheet, product form |
| **Zeigarnik Effect** — unfinished tasks stay in mind | Show what is unfinished as a short checklist: setup (sensor, range, care plan, second parent), missing products for recipes, "today's insulin log complete?" at bedtime. Never nag about medical results. | Home (setup card), Today, bedtime |
| **Jakob's Law** — people expect what they already know | Trend arrows and colours follow Libre/Dexcom; glucose in mmol/L with one decimal; iOS-style bottom tab bar; standard share/back gestures. Do not invent new meanings for familiar symbols. | Everywhere glucose appears |
| **Goal Gradient** — visible progress pulls people forward | Progress bars for setup and for multi-step forms; logging streaks. **Never** a progress bar, score or streak on glucose values, Time in Range or "good days". | Onboarding, setup, logging habits |
| **Von Restorff** — the one different thing gets noticed | One primary button per screen. Medical red appears only for a real low/urgent state, so it always means something. No decoration on data screens, so an alert stands out. | Alerts, status chips |
| **Miller's Law** — people hold about 5–9 items | Home shows at most 5 lines above the fold. Advanced opens with 6 groups. Long numbers are chunked ("19 h 41 min" instead of "82.0%" alone); lists are grouped by day. | Home, Advanced, Timeline |

Also: the app answers a tap within 100 ms (pressed state) and shows content within 1 s from cache; glucose
never waits on images or analysis.


---

## 13. Privacy

Layan's name and likeness are personal. While the app repository or link is public, illustrations of her
should not be committed. Make the repository private (or host from a private repository) before adding
`public/assets/` illustrations.

---

## 14. New-screen checklist

- [ ] Is it a data screen? Then no Layan, no decoration.
- [ ] Glucose shown as number + arrow + words + age?
- [ ] Any medical colour used for decoration? (must be no)
- [ ] Any Layan Pink near medical information? (must be no)
- [ ] Text uses the text-colour column, not the fill column?
- [ ] Works in night colours?
- [ ] Touch targets ≥ 44 px, works at 130% text?
- [ ] Nothing suggests or changes an insulin dose?
- [ ] One primary action, in the thumb zone, ≥ 52 px (Fitts, Von Restorff)?
- [ ] At most 5 tabs / 4 options / 5 lines above the fold (Hick, Miller)?
- [ ] Familiar symbols keep their usual meaning (Jakob)?
- [ ] Progress and streaks only for habits, never for glucose (Goal Gradient)?

---

## 15. Tokens (copy into the app)

The live tokens are in `src/index.css` (as RGB triplets for Tailwind) and are the source of truth; §2–§4
list the same values as HEX.

## 16. Languages (Arabic and English)

- Arabic is the source text and the default; English is chosen per phone (المزيد → اللغة, or the sign-in screen)
  and saved to `carb.members.lang` so push alerts arrive in the same language.
- The whole layout follows the language: `<html dir="rtl|ltr">`, logical Tailwind classes (`ms-`, `ps-`,
  `start-`), back/forward arrows flip. Graphs keep time running left → right in both.
- User data (recipe, product and member names, notes) is never translated. It is isolated with `<bdi>` inside
  mixed lines, and truncated lines take their own direction (`unicode-bidi: plaintext`) so a name loses its end,
  never its start. Known category names are shown through `tMaybe()`.
- How to add text: `src/i18n/README.md`. `npm test` fails if any Arabic text has no English.
