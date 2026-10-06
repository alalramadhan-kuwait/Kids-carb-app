# Mom mode (الوضع البسيط) — living plan

**Status:** steps 1–5 built and released (2.27.0, 2.28.0); next: Rawan tries it, then the alarm sound (§13). Updated after every piece of feedback (see the log at the end).
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

## 13. Alarm sound (after the mom-mode tests)

- While the app is open and a low/high alert is active: a loud repeating sound and a red flashing screen until
  someone taps «أنا عليها». Very low = urgent fast beeps; low = repeated beeps; high = softer tone.
- A per-phone switch (in mom mode and the full app). Push notifications keep the phone's normal sound; an app
  outside the App Store cannot ring through silent / Focus (Apple critical alerts) — keep LibreLinkUp's own alarms
  on as a backup.

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
- **v8 (Dad)** — add an alarm sound for low and high, after the mom-mode tests.
- **Defaults (until Dad/care team say otherwise):** 6 injection sites, no buttocks; Tresiba rotates over all sites.
- **Step 1 built (2.27.0):** no 100 g preselected; dose calculator «أعطيتها X وحدة · سجّل» saves; an alert's
  «عالجتها» opens the treatment entry with her usual juice; a recheck push 15 min after every low treatment.
- **v6 (Dad)** — doctor's rules written at the top: no NovoRapid within 2 h of the last dose (hard stop with a
  countdown); a dose has no effect after 3 h (doctor) — app counts 4 h by the family's cautious choice.
- **Steps 2–5 built (2.28.0):** portions, saved meals, all mom pages, injection sites.
- **Three-mom test (step 5) — fixed before release:**
  - Safety: the dose shows on home even when the site is skipped; Tresiba stops if given in the last 20 h (a second,
    deliberate tap to go on); a juice keeps its «افحصيها» card and «✓ فحصتها» on home; a food sent to Dad and eaten
    anyway is flagged on the plate and the dose page («… ما ينحسب بالإبرة · كلّمي بابا») and kept in the plan's note.
  - Dad's portions: warning when a carb food's portion is under 2 g carbs (a «شريحة» typed as 1 g) or far from the
    others; one-tap «حبة = X غ» from the label's serving; delete asks first; recipe plates explained.
  - Undo and change: every shot or juice opens its own page (change units or site, or «غلط · امسحيها»; a plan's dose
    deleted cancels the plan); «غلطانة؟» after the injection; the sites list rows open the entry.
  - No duplication: one main button on home (the next step); no ✕ on the plate (open the item →
    «شيليه من الصحن»); the empty plate shows her saved meals first.
  - Checking: the dose page lists the foods and the trend arrow; «إبرة تصحيح» title; «ليش؟» shows the total and
    the pen's rounding down; the injection and «شكثر أكلت؟» pages name the meal.
  - Reasons follow the direction (less: أكلت أقل / كانت نازلة / ما رضت / شي ثاني; more: أكلت أكثر / كان مرتفع /
    شي ثاني) with «اختاري السبب».
  - Words: «لا نوفورابيد قبل الساعة X»; «ساعة و43 د»; «أنت عطيتيها»; «بدون كارب»; «غرام»; tabs
    «وجباتها / طبخ البيت / أكل»; unavailable products hidden; juice names not repeated.
- **v9 (Dad, 2.28.1–2.28.2)** — the top hid under the iPhone's Dynamic Island: pages now keep their top clear and fixed.
- **v10 (Dad, 2.29.0)** —
  - Home is one fixed screen, nothing scrolls: smaller status box, the graph takes the room left.
  - Injection flow: «إبرة» → pen → **where** (suggested) → the number → saved with its site. On the meal dose page and
    Tresiba the site is a row to change. No site page after saving.
  - Rotation in cycles, in order: right arm, left arm, belly right, belly left, right leg, left leg. She can mix;
    the suggestion is the first site not used yet in this cycle (never the one just used); the cycle ends when all
    have had their turn, then starts again at the right arm.
  - Bottom tabs in mom mode: 🏠 Home · 📋 Log (last two days; a shot or juice opens to change or delete) · 🥗 Nutrition.
- **v11 (Dad, 2.30.0)** —
  - «جهزي وجبتها» splits in two: **«أضيفي وجبة»** (she eats now → dose) and **«خططي وجبة»** (the same planned meals
    as the full app: which meal, today or tomorrow, the injection time; on hold until then, reminders to both phones).
  - Adding a food: its picture and label facts (carbs per 100, the serving), then Dad's portions first, then
    «بالحصة» or «بالغرام/بالمل» (recipes: «بالصحون»), with the carbs shown before adding. Every approved product
    and complete recipe is listed; Dad's portions are no longer required.
  - A planned meal due now becomes home's main button («وقت …»); the next one shows as a small line. Its page:
    injection now (same dose page and stops), change the time, cancel. A reminder opens it.
  - 4th tab «المزيد»: planned meals (on hold), injection sites, full mode.
- **Scenario test (Dad, 2.30.1)** — McDonald's nuggets + fries + BBQ + Diet Pepsi; qaimar and honey; school breakfast
  (samoon with egg and turkey, two Lusine white toast slices, cocktail juice) and a no-carb snack (cheese, labneh,
  cucumber, turkey). Found: search hid everything not marked «موجود بالبيت» (all McDonald's and Lusine) → search now
  finds every approved food, home items first; new spellings (نقت، تشكن، صمونة، تركي، عصير كوكتيل…); «العلبة كاملة» for
  drinks without a serving. Not in the database: McDonald's BBQ sauce, Pepsi/Diet Pepsi, samoon, turkey slices,
  cucumber, labneh (KDD labneh unapproved, 27 g/100 looks wrong). Open question for Dad: a food left out (sent to Dad)
  only warns today — should it stop the dose (samoon is ~half the breakfast's carbs)?
- **Scenario follow-up (Dad, 2.30.2)** — «صمون» means the Flour Mills and Lusine rolls already in the list: search now
  links them. Added from official/standard sources (approved, source on each): McDonald's BBQ sauce (11 g a packet),
  Diet Pepsi (0), cucumber (USDA 3.6 g/100), turkey slices (generic 4.2 g/100), Baladna full-fat labneh (7 g/100).
  KDD labneh stays unapproved (its store page says 27 g/100).
- **v12 (Dad)** — "in the end most food is an estimate": a food left out (sent to Dad) keeps the warning only; the dose
  is not blocked. Decision closed.
- **v13 (Dad, 2.30.3)** — the page still slid under the clock: the body's bottom padding made it 34 px taller than the screen. Mom pages now lock the document; only inner areas scroll.
- **v14 (Dad, 2.31.0)** — the arm with the CGM sensor gets no injection, and Mom needs to know when the sensor ends.
  `sensors.site` (one migration, 20261004200013): which site the current sensor is on, asked on Home («الحساس بأي
  ذراع؟») for each new sensor and changeable in «المزيد ← الحساس». That site is drawn grey with 📡 on the body and is
  never suggested or selectable. Time left shows in Home's status line; on the last day a red card shows the end time
  (the 24 h / 2 h pushes still go to both phones).
- **v15 (Dad, 2.31.1)** — injection-site picture like the care chart Dad sent, but girly: a girl from the back and the front (hair with a bow, pink top, lilac shorts); back of the upper arms (both views), belly around the navel, outer thighs, buttocks (back view, only when enabled). Sides labelled per view.
- **v16 (Dad, 2.32.0)** — «التغذية» means the food list, not the growth page: the tab now opens the same simple food browser (foods by group with search, home cooking); an item shows its values per 100 and per serving (recipes per plate), «—» when the label does not give one, and «أضيفيها لوجبة». The growth page stays in the full app.
- **v17 (Dad) — basic food database + food groups** (split across agents):
  - Source rules: generic foods from USDA SR Legacy (offline copy; FDC id and link on each row), branded products only
    from their labels (no guessing), prepared/Kuwaiti dishes as recipes computed from their ingredients.
  - Per 100 g: carbs, calories, protein, fat, fiber, total sugar (`products.sugar_per_100`, migration 20261004203612,
    with `products.emoji` as the picture for foods without a photo). Every household portion (نصف كوب، كوب، ملعقة، حبة
    صغيرة/متوسطة/كبيرة، شريحة) is a row in `carb.portions` with its USDA gram weight.
  - Groups: خضار · فواكه · مكسرات · لحوم وبروتين · رز · خبز ونشويات · معكرونة · حبوب وبقوليات · ألبان · عصائر ومشروبات ·
    فطور · صلصات وإضافات · حلويات وسناكات · أكلات كويتية (recipes). The food pages open on a grid of groups; a search like
    «رز» lists every type with picture and carbs.
  - Built (2.33.0): 165 generic foods (147 added, 15 updated, every one USDA-sourced with portions; checked: no duplicates,
    carbs in range, kcal consistent), 7 extra ingredients and 13 Kuwaiti dish recipes (35–60 g carbs per plate; family's
    own مجبوس دجاج/لحم kept, not duplicated). Not in USDA, so not added: date syrup, corn flakes/crisped rice (brand-only),
    muesli, watermelon juice. Group grid, group pages, search across groups, carbs on every tile, item page with sugar
    and household portions, and «⚖️ قارني» (up to 3 foods side by side, per 100 g or per portion; lowest-carb marked).
- **v18 (Dad, 2.34.0) — alarm sound (§13) + connection lost 15 min.** A full-screen flashing alarm with a loud
  repeating sound (Web Audio, no files; plays even with the iPhone's silent switch where Safari allows it) while a
  very-low / low / high / no-reading alert is open and unanswered; «أنا عليها» answers it for everyone. Urgent: fast
  beeps; low: double beep; no reading: two tones every 5 s; high: softer chime every 6 s. The phone also checks itself:
  no reading for 15 min (if readings were coming in), or no answer from the server for 15 min (offline) → «ما في
  قراءة/اتصال» with «تمام» (quiet until a new reading or 30 min). Server «no reading» push moved 20 → 15 min. Per-phone
  switch with a test button in both modes. Limits: sound only while the app is open on screen (a browser cannot play
  in the background) — the server pushes and the LibreLinkUp app's own alarms stay the backup; the first tap after
  opening unlocks the sound (a hint says so).
- **v19 (Dad, 2.34.1)** — groups divided more: each group opens on sub-group tiles (`SUB_GROUPS` in productGroups.ts, by category or name word, tested): veg (starchy / salad / cooked), fruit (dates & dried / fresh), protein (chicken / meat / fish & shrimp / eggs), rice (white / brown & wild), bread (toast / Arabic & tortilla / rolls & buns / pastries / sandwiches / flour / loaves / fries & other), pasta (cooked / dry), grains (legumes / oats & grains), dairy (milk / laban & yogurt / cheese / cream), drinks (natural juice / packaged), breakfast, sauces (sugar & honey / oils / sauces), sweets (biscuits / cake / ice cream / chocolate / chips / sweets); «الكل» lists the whole group.
- **v20 (Dad, 2.35.0)** — «الشاشة تبقى شغّالة»: a per-phone switch (both modes, «المزيد») that holds a Screen Wake Lock while the app is open, asked again on return and on taps, so the in-app alarm can sound at night. iPhone needs iOS 16.4+ (home-screen app: 18.4+). Pressing the side button still locks the phone.
- **v21 (Dad, 2.36.0)** — «I want an overlay of insulin activity, not IOB, to see when it is at its peak»: the Now graph (full mode) draws the rapid insulin's activity (the same Loop exponential model's rate, `activityAt` in units/hour, the slope of IOB; tested: peaks at the care team's peak time, adds up to the dose) as a soft area over the bottom quarter of the plot, scaled so 1 unit at its peak fills it; each peak of the summed curve gets a dotted line and a «ذروة hh:mm» chip; bottom-left words say rising (with the next peak's time) / at the peak now (±10 min) / easing off; long-press shows it in u/h. Analysis has it as a layer, on by default. Mom-mode graph unchanged (offer).
- **v22 (Dad, 2.36.1)** — «Delay the action with 10 mins»: the activity overlay starts 10 min after each shot (`ACT_DELAY_MIN`, Loop's effect delay), so its peak sits at peak + 10 (75 min with 65). Display only: IOB, the forecast and the dose engine keep the care team's curve.
- **v23 (Dad, 2.36.2)** — «Simplify this page, it is overwhelming» (care-team report): nights = one sentence (fall per hour · nights below range, tinted when it needs review) + the chart, every night behind «تفاصيل كل ليلة»; meals = outcome counts, the review findings as one short list, one dose line; evidence, patterns and every meal behind one «التفاصيل». The period/settings line moved to the bottom. Printing opens every section.
- **v24 (Dad, 2.37.0)** — «Show the calculation of dose» (meal review): under «الجرعة المحسوبة» a box rebuilds the calculation from the saved snapshot (`doseSteps` in engine/dose.ts, same arithmetic as `suggestDose`, tested against it): food = carbs ÷ CR, correction = (glucose − target edge) ÷ ISF (or «ضمن الهدف · بلا تصحيح»; below target it lowers the dose), insulin still working taken from the correction only, total → rounded down to the pen step. Two decimals so the parts add up. Old plans without a snapshot show nothing extra.
- **v25 (Dad, 2.37.1)** — «make it hidden with icon to see»: the dose working opens from a 🧮 button beside «الجرعة المحسوبة», closed by default.
- **v26 (Dad, 2.38.0)** — More-page audit («a lot of icons, getting confusing»), approved plan built: five groups — Layan (Alerts & what to do · Doctor's numbers · Growth), Food (Portions · Food settings), Reports & sharing (Share · Care-team plans · Gluroo import), This phone (notifications, alarm sound, screen on, widget, simple mode, language, appearance), Family & account (members with their simple-mode switch, add parent, password, sign out) + a folded Advanced (sensor connection, advanced settings). Removed duplicates: prediction lab (Analysis header), weekly menu and snacks (Meals tab), the separate care-plan row (now first card in Alerts). Settings split by `part` into /doctor, /settings (food) and /settings/advanced with one form; links from the calculator, Now checklist, CGM, Status and Scan repointed. Ranges named apart: «نطاق الألوان», «هدف الجرعة», «حدود التنبيه», each pointing to the others. Push on/off moved from Alerts to This phone (`PhonePush`); Alerts shows a one-line link when it is off. No icon repeats; emojis dropped from rows.
- **v27 (Dad, 2.39.0)** — dietitian sheet «looks messy … mobile view and desktop and the PDF … should be with reports and sharing»: link moved from the bottom of Growth to More → Reports & sharing. Controls: one period switch (Today / 3 / 7 / 14 days) + «Other dates», Share PDF, meal times folded. Views: «بطاقات» (a card per day, newest first: totals pills, each eaten meal with foods, carbs, glucose before → after, insulin, fatty/late-rise badges, the day chart, folded day summary) and «جدول» (the A4 pages scaled to the measured width; `Page wide` on big screens). Default: cards under 900 px, table above; the choice is kept per phone. The PDF still comes from the same A4 pages.
- **v28 (Dad, 2.40.0)** — dietitian sheet audit (dietitian → developer → UI agents; reviews kept in the scratchpad, no health data in the repo). Shipped the report-only part: treatments classified from the CGM (≤25 g, not a recipe/plan, CGM < low from 30 min before to 5 min after; `isTreatment`) with their own row (start, lowest, 15-min recheck, followed by food, duplicate); columns from the plan's slot (snack → 1 or 2 by lunch), clock as fallback, no clock in headers; eating occasions (≤30 min gap) each with before / 2 h after / doses; «Affected» when food, treatment or another dose falls in the 2 h; «Low after meal» (4 h) and «Started while low»; doses linked by the plan's dose_event_id, the calculator split from events.dose_calc, minutes before eating, «Purpose not recorded»; every ingredient with amount, household measure (portion within 15 %) and carbs, «ate ¾»; pack sizes stripped (`displayName`); honest sums (≥ x, incomplete); badges (imported, needs review, recipe unconfirmed, unnamed); notes; «Not recorded» days; † for names shown as typed; the A4 page shrinks in steps on busy days. Next: one-language names (migration + curated names), then entry fixes for the parents to approve.
- **v29 (Dad, 2.41.0)** — one language on the sheet: migration 20261005110318 adds products/recipes `name_ar`, `name_en` (curated by an agent: Gulf terms, brands kept in Latin where already in the name, sizes removed; all 529 products and 24 recipes filled; a short list of uncertain names was passed to the parents). `foodName()` picks the page's language; the sheet resolves each line through its product and each meal through its recipe or single product; free text keeps † . Product edit has the two name fields.
- **v30 (Dad, 2.42.0)** — parents approved entry fix 1 and the two invisible fixes: ProductSheet gets «لعلاج انخفاض» under snack/meal, preselected when the CGM was under the low limit from 30 min before to 5 min after the chosen time and the portion is ≤ 25 g (shows «Glucose was {v} at {t}»); it saves a treatment event (product name, grams) with undo. Glucose with food is read at the eating time (`glucoseAt` in productLog) in logMeal, logQuick and when an entry is moved. Gluroo: the same juice from the other parent within 10 min with the same carbs → probable duplicate (tested). Names: KFMB Wheat = flour; Al Matahen Thyme/Zaatar croissant = same product (English unified; two rows remain). Mom juice «When?», duplicate warning and required insulin purpose not chosen (left as is).
- **v31 (Dad, 2.42.1)** — «so now all breakfasts are correct?»: checked against the real 28 Sep–5 Oct entries; two were still wrong (2 Oct 11:22 and 3 Oct 10:58–10:59 in Snack 1, and the 3 Oct milk counted as a treatment because the low came 3 min after eating). Fixes: a treatment needs the CGM low in the 30 min up to eating (not after); no breakfast → the first Snack 1 occasion with ≥ 20 g or a dose becomes breakfast; a low already treated with her back in range → later food is food (3 Oct 21:05 apple). Re-checked: every breakfast now in its column; treatments 28 Sep 16:51 and 23:14, 30 Sep 23:02, 2 Oct 02:16/08:16/12:41/12:44/22:48, 3 Oct 04:21/07:56, 4 Oct 06:45.
- **v32 (Dad, 2.42.2)** — «why is it hard to log in?»: the phone had filled in the Timekeeper (shift app) account ajr015@manpower-control.local — same sign-in system and same github.io address — which is not a household member, so the setup (claim code) screen showed. Login now refuses a username without @ or a *.local address with a plain message; the not-a-member screen shows the signed-in email, «Sign in with another account» first, and the activation code folded.
- **v33 (Dad, 2.43.0)** — «desktop view, use the full space»: full mode only, at lg (≥ 1024 px): the five tabs become a side menu (logo, version) and pages shift by its width; `Page` widens to 5xl (wide: no limit); Now is two columns (glucose card + taller graph + on-board lanes | today, plans, growth, last entries, research question); Meals two columns (suggestions | snacks + frequent food); More groups in two columns; Analysis full width; sheets open as centred dialogs; the + button sits at the bottom end. Phones unchanged; mom mode unchanged.
- **v34 (Dad, 2.43.1)** — «4 Oct cornflakes, why not dinner?»: the dinner plan's entry had been deleted and the meal logged again, so the plan pointed at a missing entry and the sheet fell back to the clock (18:46 → Snack 2). Migration 20261005115005 re-links it (same minute), clears any other dangling link, and adds a foreign key `on delete set null`; the sheet also matches an eaten plan without a link to the entry within 10 min of its eating time.
- **v35 (Dad, 2.43.2)** — «increase the graph size and show the low treatment within the graph»: DayChart redrawn at 900×250 (graph box 1.9 : summary 1 on the A4 page), dashed low/high lines, a faint red zone under the low line, and each treatment as a red point on the curve at its time with a dashed drop to the axis and a «15 g» pill above (labels step up when close).
- **v36 (Dad, 2.44.0)** — «after approving the dose give the chance to edit dose time and meal»: the plan sheet in its dosed state shows «Dose {u} U · at [time]» with a save button (`setDoseTime` moves the dose event and the plan's dosed_at/dose_at together, never into the future), and «Edit meal» stays available; `savePlan` keeps the reminders' `notified` when editing a dosed plan, so no second «time to eat» push.
- **v37 (Dad, 2.45.0)** — «recalculate the dose when the meal is edited»: in the dosed plan sheet, when the meal's carbs differ by ≥ 1 g from what the dose covered (`carbs_planned`, else the snapshot), `mealChangeDose` (engine/dose.ts, tested) applies the same CR (the snapshot's, else the current block): more food → the extra food dose rounded down to the pen step with «Give X extra units» (`topUpDose`: a second rapid meal dose noted «إضافة للوجبة بعد تعديلها», plan given/calc units added, carbs_planned updated so the box goes away); under one pen step → says so; less food → a warning with the extra insulin in units, nothing taken back. The correction part of the first dose is not recalculated.
- **v38 (Dad, 2.45.1)** — «when I click log it does not close → multiple entries» (5 Oct lunch saved 3×): the plans list keeps eaten plans (2 days), so the check sheet stayed open on the same plan with its buttons. Now «She ate» and «Not eaten» close the sheet; an eaten/skipped plan opens as a done view (logged ✓ time · carbs, «Open the review»); `ate()` re-reads the plan's status and refuses a second log (`already_eaten`). The two extra 5 Oct copies were not deleted by me (the delete needs the parents' confirmation).
- **v39 (Dad, 2.45.2)** — «remove this top alarm, I know it is rising fast»: AlertStrip no longer shows rapid_rise (the glucose card already says it) and folds a high once acknowledged; lows always stay. Push notifications unchanged (the rising-fast one can be turned off in Alerts by leaving its rate empty).
- **v40 (Dad, 2.45.3)** — «same smooth graph as Libre in simple mode»: BigGraph now averages readings into 15-minute points (Libre's history step), keeps the newest reading as the last point, and draws a monotone cubic curve (Fritsch–Carlson: smooth, no overshoot beyond real values); gaps over 20 min stay breaks. Full-mode graph unchanged (it shows every reading for reading points).
- **v41 (Dad, 2.45.4)** — «graph pointer in simple mode like Libre»: touching or dragging on BigGraph shows a thin vertical line at that time, a white dot on the curve at the nearest 15-minute point (within 30 min), the value in a pill at the top and the clock time under the axis (hour labels fade); lifting the finger hides it. touch-action none on the graph so dragging doesn't scroll.
- **v42 (Dad, 2.45.5)** — two asks. (1) Pointer like Libre's: the dark pill is gone; the value is bold text above the plot (PT 8→30 to make room) with a small unit beside it, following the line but clamped to the card; the dot is r 5, hollow, thin outline; scrubbing, snapping, faded hour labels and event markers unchanged. (2) Shared activity pushes: triggers on carb.events / carb.meal_history queue manual entries (source null, signed-in author, time within the last 3 h) in carb.activity_feed and wake the new carb-activity edge function via pg_net; a once-a-minute cron sends anything left. Kinds meal / rapid / long / treatment / finger, each switchable per person (members.activity_push, rpc set_activity_push; full mode under Notifications, simple mode More → «أخبرني لما يسجّل غيري»). The author is never notified; an entry deleted before sending isn't sent; a row queued over 15 min ago is dropped. Message «نوفورابيد 4 وحدة · من رَوان» / “Rawan added NovoRapid 4 U”, body the Kuwait time (and the food name for meals and treatments). Tap opens ./#/?at=<ms>: simple mode starts the graph pointer at that time. carb-glucose was not redeployed: the activity code lives in its own function so the alert function stays exactly as running. Migrations 20261005171222 and 20261005182017.
- **v43 (Dad, 2.46.0)** — «she ate the same meal as Friday, why is it not compared?». Cause: Meal response groups only by recipe or by a product that is ≥70 % of the carbs, and the entry's “before” list matches only the exact name or recipe; Friday was nuggets + regular fries logged as two entries, Monday one “Dinner” with nuggets + small fries + BBQ sauce. New engine/sameMeal.ts: a sitting = entries < 30 min apart; foods compared by their words (brand, sizes, counts, amounts, filler and Arabic spelling variants removed; عيش/أرز/rice = رز); two sittings are the same meal when ≥60 % of each one's carbs are foods the other had (same recipe = same meal); up to 3 earlier sittings in 90 days. components/SameMeal.tsx overlays the curves from −30 to +240 min aligned at the first bite (this time bold), doses as dots, and per time: carbs, units, dose timing, start, highest and when, 2 h; an earlier time is cut where other food, a treatment or a correction starts (meals.assess) and says so. Shown as «🔁 نفس وجبة …» under the graph on Now and simple-mode home for the meal of the last 4 h (≥20 g), and in a meal's details; pages /same/:id and /mom/same/:id. Checked against the last 30 days: Friday↔Monday McDonald's (score 0.80), toast breakfasts, molokhia lunches and egg sandwiches pair; different rice lunches do not.
- **v44 (Dad, 2.46.1)** — «why are the crackers still breakfast» (3 Oct 7:56: Cocktail juice 15 g during a 3.8 low, Ritz 6 g 26 s later). The v35 “low already treated and back in range → food” rule fired because the juice was logged first and the sensor read 4.1; a treatment cannot work in seconds. The earlier treatment now has to be at least TREAT_WORKS_MIN = 10 min before the item. Real data 27 Sep–5 Oct: only 3 Oct 7:56 Ritz and 30 Sep 23:02 snack bar (4 g, 3 min after juice, low 65) move to treatments; 3 Oct breakfast becomes the 10:58 sandwich + milk with its 2 u.
- **v45 (Dad, 2.46.2)** — «why no notification for this log?». Entries were queued but never sent: service_role had no privileges on carb.activity_feed, carb.events, carb.planned_meals and carb.meal_history, and supabase-js returned the failed reads as empty, so carb-activity reported “sent 0”. The same missing grants meant planned-meal reminders (planReminders) and the low-treatment recheck (treatRechecks) had never been sent either (notifications log: only alert/repeat/resolved/escalate in 10 days). Grants added (migrations 20261006045639, 20261006045944); carb-activity now throws on a failed read or claim instead of returning 0. Queued rows older than 15 min were dropped, not sent late; reminders over 30 min late are never sent. Verified: Rawan's 6:45 treatment re-sent, Apple 201 to Dad's iPhone. Rawan's phone had no push subscription — simple mode had no way to turn notifications on: «الإشعارات على هالتلفون» added to Mom More and the activity page.
- **v46 (Dad, 2.46.3)** — «reduce the graph a little to show the logs; one row for injections / finger-pricks, one for meals and low treatments, no overlay». BigGraph: plot 20 px shorter (PH = HH − PT − 64, min height 180); row 1 (PT+PH+13) 🍽️ meals ≥5 g and 🧃 treatment events, row 2 (PT+PH+34) pen-coloured dose circles and 🩸 finger-pricks, hours at HH−3. lane() places each marker at its time and moves it just enough sideways (19 px) never to sit on the previous one, pulling back from the right edge. Before, the dose circle covered the hour labels and treatments/finger-pricks were not drawn. «نفس الوجبة» banner on mom home is one line (day only).
