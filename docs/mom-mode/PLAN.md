# Mom mode (الوضع البسيط) — living plan

**Status:** step 1 built (2.27.0); steps 2–5 not built. Updated after every piece of feedback (see the log at the end).
**Mockups:** `v1-screens-1..3.png` (12 screens), `v2-home-products-pens.png`, `v3-injection-sites.png`; sources
`mom.html`, `mom2.html`, `mom3.html` (open in a browser). All numbers in mockups are made up.

## Core rule

**Dad builds and verifies the database. Mom builds meals from it. The app does the math.**

Mom needs to answer three things quickly: *How is Layan now? What should I do? What can she eat?* No nutrition
knowledge is required. Mom mode has no separate food database; it uses the same products, recipes and meal plans.

## Doctor's rules (always enforced, in every screen)

1. **No rapid insulin (NovoRapid) within 2 hours of the last NovoRapid dose.** The app already holds this rule
   (`dose_gap_min = 120`). In mom mode it is a hard stop: no dose number, and the screen says
   «لا تعطينها إبرة الحين — آخر إبرة قبل 1:10 · الإبرة الجاية بعد 50 دقيقة (الساعة 9:20)», whoever gave the last one.
   The home screen shows the same countdown while it runs. Tresiba (long-acting) is not counted in this gap.
2. **After 3 hours a NovoRapid dose no longer affects her sugar** (the doctor's insulin action time).
   The family set the app to count it for **4 hours** to be cautious (4 Oct 2026), so "insulin still working" fades
   to zero at 4 h; the doctor's 3 h is recorded here and in the care-team report. Changing it back to 3 h is a
   setting, not a code change.

These come from the care team and are never overridden by Mom mode. Any other care-plan rule (treat-low amount,
recheck time, maximum dose) is read from the care plan, not written into Mom mode.

## Who

- Mom mode is per person: it opens on **Rawan**'s account. Dad keeps the full app.
- One link «الوضع الكامل» leaves it. No settings can be changed in mom mode.
- Language: simple Kuwaiti Arabic. Words never shown in mom mode: «غ/100غ», «مليمول», «نشط», forecast lines.
  Injection is «إبرة». Footer: «الأرقام من خطة الدكتور».
- Mom **sees the carb total in small text** (yes). No clinic number (none shown; contact is Dad).

## Screen and text rules (Dad, v7)

- **No bottom sheets / slide-up panels in mom mode.** Every choice opens a **full new page** with a back arrow
  (browser back works too), so she can go back and forth and nothing half-covers the screen.
- **Very little text.** Simple words and numbers. One short line per screen at most; no explanations unless she
  taps «ليش؟». Big buttons, big numbers, pictures.
- Every step must be easy to **choose**, easy to **check** (what was chosen is visible before saving) and easy to
  **change** (tap any item to edit it; undo after saving).
- **No duplication**: each thing is done in one place only (one way to log a meal, one way to log a juice, one way
  to log an injection).

## 1. Home

- Header: «ليان», and how old the reading is («قبل دقيقتين»).
- **Big coloured box like LibreLinkUp**: the number and arrow, one word, one line of what to do:
  - green «زين ومستقر · ما يحتاج تسوين شي»
  - amber «قاعد ينزل — انتبهي» / «مرتفع»
  - red «نازل — عطيها عصير الحين» (text from the care plan; a *predicted* low is not worded as "treat now")
  - no reading for 15 min or more: «ما في قراءة جديدة — افحصيها بالإصبع» (never «زين» on an old reading)
- **Large simple graph like LibreLinkUp**: last 12 h, mmol/L axis 3–21, green target band, dashed red low line,
  dashed orange high line, big dot on the latest reading. Doses as coloured dots on the time axis with the units
  inside; meals as 🍽️. Legend: نوفورابيد · تريسيبا · أكل.
- «آخر شي»: last NovoRapid and last Tresiba (pen colours, units, time) and last meal — so neither parent doses twice.
- Buttons: big **🍽️ جهزي وجبتها**; then **🧃 عطيتها عصير** and **💉 عطيتها إبرة**.
- When low: the box and dot turn red, one big button «عطيتها العصير»; meal and insulin buttons locked until she rises.

## 2. Pen colours (all screens, graph, history)

- **NovoRapid = orange** `#F28C28` (orange-coded label and dose button).
- **Tresiba = light green** `#8DC63F` (Tresiba 100 units/mL pen and label are light green).
- No official colour codes were found; shades chosen to match. Adjust from a photo of her pens if needed.

## 3. Products: full page, grouped, easy to find

- A full page (not a small sheet): search on top («ابحثي: كورن فليكس، توبي، عصير…»), group chips
  (الكل · ألبان · مشروبات · خبز · فطور …), then sections of photo cards: فطور، ألبان وجبن، مشروبات، خبز وسناك…
- Search understands family words (كورن فليكس، النمر، توبي، مجبوس، عيش…).
- In mom mode only items that have portions (section 5) appear; others show «اسألي بابا».

## 4. Workflow — build a meal («جهزي وجبتها»)

- «شنو بتاكل ليان؟» with three tabs: **وجبات محفوظة | وصفات | منتجات**, «الأكثر استخداماً» photo cards first.
- Choose an item → **portion buttons with pictures**: «صحن ليان الصغير / الكبير / نص صحن», «كوب ليان», «حبة».
  Nothing preselected. Grams only under a small «كمية ثانية (للمتقدم)» link.
- The meal list shows each item and its portion; near-zero items show «ما فيه سكريات تُذكر»; total carbs in small text.
- «+ إضافة شي», «التالي». After the same combination 3 times: «تحفظينها كوجبة؟».

## 5. Portions (Dad, once, with a kitchen scale)

- Dad's screen «كميات ليان»: for each product/recipe, named portions with a photo of *her* plate/cup and a weight
  (e.g. Frosties: صحن ليان الصغير 30 g → 26 g carbs; الكبير 45 g; نص صحن 15 g).
- Also lists what is waiting for Dad: new foods from Mom, plates to weigh.
- Re-check portions at each care-team review.

## 6. Saved meals

- A saved meal stores items + portions, never carb numbers; carbs are recomputed from the database each time,
  so correcting a product corrects every saved meal. One tap loads it; portions can still be changed.

## 7. Workflow — before eating (dose)

- Meal carbs, sugar now, last rapid injection (who and when).
- «حسب خطة الدكتور: X وحدة» from the care-team settings (CR, ISF, target, insulin action 4 h, pen step) with «ليش؟»
  showing the parts (food, correction, insulin still working, pen rounding).
- **Stops instead of guessing** (no number, says why, «اتصلي ببابا», «سجّلي الأكل بدون إبرة»):
  low or falling; no recent reading; any item still waiting for Dad; **a NovoRapid dose within the last 2 hours
  (doctor's rule 1)** — «بابا عطاها 3 وحدات قبل 40 دقيقة · الإبرة الجاية بعد 1:20» with the time it becomes
  allowed; above the care plan's maximum.
- «كم عطيتيها؟ [−] X [+]», and the dose is saved **only** when she presses «💉 سجّلي الإبرة بعد ما تعطينها».
  If different from the plan: one-tap reason — أكلت أقل / كانت نازلة / ما رضت.

## 8. Workflow — after the injection

- «✓ تم تسجيل الإبرة · X وحدة · الساعة 7:20», countdown «الأكل بعد 9:34 · الساعة 7:30» (injection time + 10 min),
  «بابا يشوفها الحين», button «🍽️ بدأت تاكل».
- Then **where was it given** (section 10).

## 9. Workflow — what she actually ate

- «شكثر أكلت ليان؟»: كلها / تقريباً نصها / شوي (ربع) / أعدّل كل شي لحاله.
- Planned and actual carbs both kept for the meal reviews. If she ate less after the injection: the care-plan rule
  is shown and a recheck reminder is set; no extra food is suggested unless the care plan says so.

## 10. Injection sites (rotation)

- After recording any injection: «وين عطيتيها الإبرة؟» — a simple body drawing (front), six sites:
  بطن يمين/يسار، فخذ يمين/يسار، ذراع يمين/يسار (her right on the viewer's left). Each shows when last used.
- **Suggested next site** in green with ⭐ = the one used longest ago (within the sites allowed for that insulin);
  one button confirms it («✓ عطيتها بالفخذ اليمين»), or tap another site.
- «أماكن الإبر» history: counts per site over 14 days (overused turns red with
  «البطن اليمين مستخدم وايد · جربي أماكن ثانية · ولا تعطين بمكان فيه تكتل أو انتفاخ»), a list with pen colours,
  filter by insulin.
- **Open:** add buttocks? does Tresiba stay in its own sites (e.g. thighs only)?

## 11. Low treatment («عطيتها عصير»)

- One tap records **her usual juice** (1.2.3 Cocktail 125 ml), shows «افحصيها بعد 14:21», reminds at +15 min;
  if Mom doesn't confirm within 5 min, Dad is notified. «عطيتها غيره» / «تراجع».
- The alert's «تم/عالجتها» also records the juice.

## 12. New / unknown food

- «مو موجود بقاعدة ليان» → photo + name → «أرسليه لبابا يضيفه».
- For now: «احسبي باقي الوجبة بدونه» or «انتظري بابا». Never a dose for an uncertain item.

## Data changes (one migration when built)

- `members.simple_mode` (Rawan on).
- `portions` for products and recipes (label, grams/ml, photo).
- `saved_meals` (name, photo, items with product/recipe + portion).
- `events.injection_site`, plus per-insulin allowed sites in settings.
- Reuse `planned_meals` for build → dose → eat → amount eaten → review.

## Build order

1. Safety fixes in the current app (for both parents): no 100 g preselected; "Use" saves the dose; the alert's
   «عالجتها» records the juice; a recheck reminder after every juice.
2. Portions + Dad's portion screen (start with her ~15 most-eaten foods).
3. Saved meals.
4. Mom mode: home + graph, products page, meal → dose → injection → site → amount eaten, juice, injection buttons.
5. **Test with three agent "moms" from different backgrounds** (after mom mode is built): each tests every screen and
   flow in the real app (mock data) and reports on the interface — that everything follows the workflow, nothing is
   duplicated, and every step is clear and easy to choose, check and change. Fix, then Rawan tries it.

## Feedback log

- **v1** — first draft; usability test by an agent playing Mom (problems: grams default 100 g, "Use" doesn't save,
  separate food/dose flows, jargon, alert ack records no juice).
- **v2 (Dad)** — Mom builds meals only from the existing database (saved meals | recipes | products), calibrated
  portions like «صحن ليان الصغير», planned vs actual carbs, saved meals, unknown food goes to Dad, no separate
  database. Mom = Rawan; Mom sees carbs (small); no clinic number. Mockups of 12 screens.
- **v3 (Dad)** — graph large and simple like LibreLinkUp; dose colours follow the pens (NovoRapid orange,
  Tresiba light green); products as a full, grouped page.
- **v4 (Dad)** — track where each injection is given, rotate between sites and suggest the next one.
- **v5 (Dad)** — keep all details in this plan and update it after every feedback.
- **v7 (Dad)** — full pages instead of bottom sheets for every choice (back and forth, no lag); very little text,
  simple words and numbers; after building, three agent moms from different backgrounds test everything (workflow,
  no duplication, easy to choose/check/change) and report.
- **Defaults (until Dad/care team say otherwise):** 6 injection sites, no buttocks; Tresiba rotates over all sites.
- **Step 1 built (2.27.0):** no 100 g preselected; dose calculator «أعطيتها X وحدة · سجّل» saves; an alert's
  «عالجتها» opens the treatment entry with her usual juice; a recheck push 15 min after every low treatment.
- **v6 (Dad)** — doctor's rules written at the top: no NovoRapid within 2 h of the last dose (hard stop with a
  countdown); a dose has no effect after 3 h (doctor) — app counts 4 h by the family's cautious choice.
