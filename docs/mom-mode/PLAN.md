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
