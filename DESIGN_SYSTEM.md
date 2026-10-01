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

## 2. Brand colours (light)

| Token | Name | HEX | Use |
|---|---|---|---|
| `--primary` | Layan Periwinkle | `#7776D8` | Large shapes, selected tab icon, illustrations |
| `--primary-strong` | Deep Periwinkle | `#5E5CC4` | **Buttons, links, any text in primary** (5.5:1 on white) |
| `--primary-soft` | Soft Lavender | `#E8E7FA` | Selected chips, secondary buttons |
| `--secondary` | Powder Blue | `#B9D7EE` | Decoration, info backgrounds |
| `--accent` | Layan Pink | `#F49AB6` | Decoration only (see rule below) |
| `--accent-soft` | Blush Pink | `#FCE5ED` | Celebration backgrounds, onboarding |
| `--highlight` | Butter Yellow | `#F6D982` | Stars, tips, small highlights |
| `--bg` | Warm Cream | `#FFF9F3` | App background |
| `--surface` | White | `#FFFFFF` | Cards |
| `--text` | Deep Brown | `#302B2B` | Main text |
| `--text-2` | Warm Gray | `#6F6A6C` | Secondary text (darkened from #777274 to pass 4.5:1 on cream) |
| `--border` | Soft Gray | `#E9E5E3` | Card and input borders |

**Pink rule.** Layan Pink is close to Low red. It never appears on, next to, or behind a glucose value, a
status chip, a graph or an alert. Use it for decoration and non-medical moments only.

**Primary rule.** White text on `#7776D8` is 3.9:1, which is too weak for buttons. Buttons and links use
`--primary-strong`.

## 3. Night colours (dark)

Used automatically by the Night schedule and when the phone is in dark mode.

| Token | HEX |
|---|---|
| `--bg` | `#17162B` |
| `--surface` | `#222140` |
| `--surface-2` | `#2C2B52` |
| `--text` | `#F1EEF7` |
| `--text-2` | `#B4AFC6` |
| `--border` | `#37355E` |
| `--primary` / `--primary-strong` | `#A9A8F2` (text on it: `#17162B`) |
| `--primary-soft` | `#33316A` |
| `--accent` | `#E58AA6` (decoration only) |

Night mode removes shadows, uses borders instead, and hides decorations entirely.

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
live screen.

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

| Role | Font | Size / weight |
|---|---|---|
| Arabic UI | **Noto Sans Arabic** | — |
| English UI and all digits | **Nunito Sans** | — |
| Glucose on Home | Nunito Sans | **64 px / 700** |
| Glucose in Night mode | Nunito Sans | **96 px / 700** |
| Glucose in cards and lists | Nunito Sans | 40–48 px / 700 |
| Screen title | Noto Sans Arabic | 26 px / 700 |
| Card title | Noto Sans Arabic | 18 px / 600 |
| Body | Noto Sans Arabic | 16 px / 400, line-height 1.6 |
| Secondary | Noto Sans Arabic | 14 px / 400 |
| Caption (minimum size) | Noto Sans Arabic | 12 px / 500 |

Rules: medical values always use Western digits (0–9), tabular figures, and are never wrapped across lines.
No weight below 400. No handwriting or cartoon fonts anywhere data appears.

Fallback stack: `"Noto Sans Arabic", "Nunito Sans", system-ui, -apple-system, "Segoe UI", sans-serif`.

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

---

## 15. Tokens (copy into the app)

```css
:root {
  --primary: #7776D8; --primary-strong: #5E5CC4; --primary-soft: #E8E7FA;
  --secondary: #B9D7EE; --accent: #F49AB6; --accent-soft: #FCE5ED; --highlight: #F6D982;
  --bg: #FFF9F3; --surface: #FFFFFF; --surface-2: #F7F2EE;
  --text: #302B2B; --text-2: #6F6A6C; --border: #E9E5E3;

  --st-urgent: #C83E4D; --st-urgent-text: #A82F3D; --st-urgent-soft: #F7DADD;
  --st-low: #E95F68;    --st-low-text: #B83A44;    --st-low-soft: #FCE6E8;
  --st-in: #46B98A;     --st-in-text: #1F7A55;     --st-in-soft: #E3F5EC;
  --st-high: #F2A541;   --st-high-text: #8F5A00;   --st-high-soft: #FDF1DC;
  --st-vhigh: #D9822B;  --st-vhigh-text: #8A4A0F;  --st-vhigh-soft: #FBE9D8;
  --st-info: #519AD4;   --st-info-text: #2C6FA6;   --st-info-soft: #E4F0FA;

  --radius-card: 22px; --radius-btn: 16px; --radius-input: 14px; --radius-pill: 999px;
  --shadow-card: 0 2px 10px rgba(48, 43, 43, 0.06);
  --font: "Noto Sans Arabic", "Nunito Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-num: "Nunito Sans", system-ui, sans-serif;
}

/* Night: applied by the night schedule or the phone's dark mode */
:root[data-theme="night"], .night {
  --primary: #A9A8F2; --primary-strong: #A9A8F2; --primary-soft: #33316A;
  --accent: #E58AA6; --bg: #17162B; --surface: #222140; --surface-2: #2C2B52;
  --text: #F1EEF7; --text-2: #B4AFC6; --border: #37355E; --shadow-card: none;
  --st-urgent: #FF5A68; --st-urgent-text: #FF5A68; --st-urgent-soft: #3A1E2A;
  --st-low: #FF7A83;    --st-low-text: #FF7A83;    --st-low-soft: #3A2030;
  --st-in: #5FD3A2;     --st-in-text: #5FD3A2;     --st-in-soft: #1B3534;
  --st-high: #F5B65A;   --st-high-text: #F5B65A;   --st-high-soft: #3A2E22;
  --st-vhigh: #F0954A;  --st-vhigh-text: #F0954A;  --st-vhigh-soft: #3A2820;
  --st-info: #7CB8E8;   --st-info-text: #7CB8E8;   --st-info-soft: #1E2E46;
}
```
