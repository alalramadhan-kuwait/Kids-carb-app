# Stage 0 audit — Personalized Diabetes Learning System

Date: 23 October 2026 · App version at audit: 4.29.0 (commit 5dc3ef8) · Read only: nothing in production, the database
or the dose calculator was changed for this audit.

## 0. Summary

- **About 55–60 % of the master plan already exists.** The foundation (one event store, audit trail, dedupe, frozen
  predictions, research lab, Basal Check by Tresiba dose) is in place. Missing: the benchmark gate at 30/60/120/240 min,
  uncertainty, a few schema fields, and the sign-off package.
- **No urgent app-safety defect found.** The dose calculator reads only logged carbs and insulin on board; it uses no
  absorption curve and no forecast. Low alerts run server-side on readings alone.
- **One clinical item for the care team (not a dose suggestion):** Tresiba has stepped down weekly 11 → 10 → 9 → 8 → 7 U
  since 28 Sep. Each dose had only 2–3 settled nights, and **7 U has none yet** (first settled night: 24 Oct if
  unchanged). Fasting-window drops have been outside ±1.7 mmol/L on 13 of 14 reviewed nights (median −4.6). This is for
  the treating team to read, with Basal Check, not for the app to interpret.
- **The data is thin for personalised forecasting.** 26 days of CGM, 127 meals, 95 rapid doses, 0 exercise and 1 sleep
  entry. Any candidate model must stay experimental unless out-of-sample results are clear.

## 1. Inventory

### 1.1 Data (Supabase project `fhnqaurtryfmmomvzrpl`, schema `carb`)

| Table | What it holds | Audit / provenance today |
|---|---|---|
| `glucose_readings` | CGM, mg/dL, primary key `taken_at`, trend, `source` | Upsert on `taken_at` (`supabase/functions/carb-glucose/index.ts:373`); source = Gluroo import (27 Sep–1 Oct) or LibreLinkUp |
| `events` | insulin (rapid/long, purpose, site, `dose_calc`), carbs, treatment, bg_check, exercise, sleep, note | `client_id` unique (retry-safe), created/edited/deleted by + at, soft delete, `source` |
| `meal_history` | meals with items (`lines`), carbs/fat/protein/fiber/kcal, `intake` (pending/eaten), `ate`, `carbs_unknown`, `needs_review` | `client_id` + `source_key` unique, edited/deleted by + at, soft delete |
| `entry_audit` | 250 rows of edit history | — |
| `recipes`, `recipe_versions`, `products`, `portions` | food data; nutrition source tag read from notes (`src/engine/source.ts`) | recipe versions kept |
| `predictions` | 153 frozen meal predictions (`params`, `curve`, `checks` at 1 h / 2 h / end) | `key` unique; params stored per row |
| `research_runs`, `research_models`, `unexplained_events`, `research_questions` | the 12-hourly lab (43 runs, `unseen_from` held-out window, `code_version`) | — |
| `sensors`, `bg_comparisons` | sensor sessions (2), finger-prick vs CGM pairs (34) | — |
| `settings` | care-team parameters: DIA 240 min, peak 65 min, absorb 180 min, one ratio block (CR 13, ISF 90), dose-to-meal 10 min | **no effective dates or history** |
| `alerts`, `planned_meals`, `share_links` … | alerts episodes, meal plans, widget/feed links | — |

### 1.2 Engines (`src/engine`, all pure and tested in Node)

| Area | Files (main functions) | Used by |
|---|---|---|
| Meal absorption | `absorb.ts` (`absorbing`, `stillToAbsorb`, `foodsFrom`, `foodEnd`, `foodLane`) | Now cards, FoodLane strip, Status COB, graph COB track, OnBoardLanes |
| Older carb model | `iob.ts` (`carbsFrom`, `cobAt` linear, `carbLane`) | frozen predictions (`lib/predictions.ts` → `predict.ts`), lab, `status.ts` estimate time, dose screen prefill of logged grams |
| Rapid insulin | `iob.ts` (`iobFraction`, `iobAt`, `activityFraction`, `activityAt`, `ACT_DELAY_MIN = 10`, `dosesFrom`, `insulinLane`) | dose calculator (protected), cards, graph, widget copy |
| Dose | `dose.ts`, `doseAt.ts`, `useLiveDose` | DoseCalculator, Mom dose — **out of scope, unchanged** |
| Forecasts | `trend.ts` (30-min projection, `DAMP 0.5`), `forecast.ts` (`trendForecast`, `onboardForecast` gated by `ONBOARD_VALIDATED=false`), `predict.ts` (frozen meal curves), `status.ts` (`onBoard.est`, gated) | Now, Analysis, Status, PredictionAccuracy |
| Research | `research.ts` (15/30-min scoring, similar-meal, FPU), `forecasters.ts` (Holt, Kalman, AR/ARX, Loop-style, UAM), `lab.ts` (walk-forward) | Research page, lab runner |
| Basal / fasting | `basal.ts`, `basalCheck.ts` (`steadyDoses: 4`), `nightTresiba.ts` (`settle: 3`), `nightGrid.ts`, `nights.ts` | Basal Check page, Night section, visit report |
| Meals compared | `sameMeal.ts`, `meals.ts`, `planCompare.ts`, `planReview.ts`, `gi.ts` | Same meal, Meal response, Plans |
| Sensor | `fingerprick.ts`, `prick.ts` | Sensor accuracy, Mom prick |
| Alerts (server) | `supabase/functions/carb-glucose/alerts.ts` (`FADE 0.7`, `LOOK_MIN 30`) | push alerts — **protected** |
| Widget | `public/widget/layan-widget.js` (own JS copies of IOB and absorption; parity test in `run.ts`) | iOS Scriptable |

## 2. Duplicate / contradiction matrix

| # | Concept | Where it is computed | Same meaning? | Verdict |
|---|---|---|---|---|
| 1 | Active carbs / COB / «باقي ~X غ» | `absorb.stillToAbsorb` on Now card, strip, Status, graph track, widget (4.29.0) | Yes: one definition, "grams estimated still to be absorbed" | **Keep** (canonical) |
| 2 | Same, older | `iob.cobAt` / `carbLane` (linear over 180 min) | No: linear, no fat | **Consolidate**: keep `cobAt` only as the named "v1" model inside frozen predictions and the lab; remove `carbLane` (no screen uses it); stop `status.ts` using the linear window for its estimate time |
| 3 | Absorbed carbs | not shown anywhere | — | Nothing to do; define if ever shown (logged − still to absorb) |
| 4 | Fast/slow split | `absorb.ts` and the widget's JS copy | Same rule, same inputs (`f` fat, `d` drink via `share_view`) | **Keep** + parity test; better: generate the widget's model block from `absorb.ts`/`iob.ts` at build |
| 5 | Insulin on board (U) | `iobAt` everywhere + widget copy | Yes | **Keep** |
| 6 | Insulin activity (U/h) | `activityAt` with 10-min onset delay after the **recorded** time | Different quantity from IOB, correctly separate | **Keep**; label the 10 min as onset, not a pre-meal offset |
| 7 | Insulin effect on glucose (mmol/L) | only inside gated forecasts and frozen predictions | — | **Requires validation** (Stage 3) |
| 8 | Tresiba | excluded from `dosesFrom`; flat band on the strip; Basal Check / Night | Correctly separate | **Keep** |
| 9 | "Settled" Tresiba | `basalCheck` = from dose 4; `nightTresiba` = from night 4 (`settle: 3`) | Nearly, but counted differently | **Consolidate** to one rule in `basalCheck` |
| 10 | Short look-ahead | Home «≈ X at hh:mm» (`trend.ts`, damping 0.5) vs alert "low expected" (`alerts.ts`, fade 0.7 per 5 min) | **No**: two formulas for the next 30 min | **Requires review**: alerts stay as they are; align or relabel the Home projection so it can't read as contradicting an alert |
| 11 | Meal glucose prediction | `predict.ts` frozen curves (linear COB, doctor's ratios) | v1 record | **Keep** as history; add `model_version` |
| 12 | Curve forecast on graph / Status | `onboardForecast`, `onBoard.est` | Not validated (MAE 3.3 / 3.4 / 4.9 mmol/L at 1 h / 2 h / end) | **Replace** only through the benchmark gate; off since 4.29.0 |
| 13 | Research predictors | `research.ts` + `forecasters.ts` + `lab.ts`, 15/30 min | Experimental | **Consolidate** into one benchmark harness, 30/60/120/240 min |
| 14 | Injection time | recorded `occurred_at` everywhere; `dose_to_meal_min = 10` only in Plans/reminders | Correct | **Keep**. Data: median dose 9.5 min before the meal (74 of 127 meals had a rapid dose −20/+30 min) |
| 15 | Glucose duplicates | primary key `taken_at`, upsert | No cross-source duplicates; LibreLinkUp gives 1-minute readings since 1 Oct (24,371 gaps of 30–90 s are normal) | **Keep**; add quality flags (below) |
| 16 | Meal double counting | carbs events vs meals | 0 carbs events within 20 min of a meal; 0 duplicate meals; 0 duplicate doses within 10 min | **Keep** |
| 17 | Treatment vs drink | `kind = 'treatment'` used for a low rescue **and** for drinks with food (2 cases: chocolate milk before breakfast, cocktail drink with a snack) | **No** | **Consolidate**: mark the purpose (low / drink) so a rescue is never learnt as a meal |
| 18 | Time zone | fixed UTC+3 in ~65 places | Kuwait has no daylight saving: correct | **Keep**; one shared constant later (low value now) |
| 19 | Care-team parameters | one `settings` row | No effective dates in `settings`; the history survives only inside frozen predictions: DIA 360 → 240 min (~4 Oct), ISF 54 → 72 (~8 Oct) → 90 (~12 Oct), CR 15 → 13 (~12 Oct) | **Consolidate**: effective-dated parameter history, backfilled from those predictions and marked approximate |

## 3. Data quality and coverage (as of 23 Oct)

| Item | Value |
|---|---|
| CGM readings | 29,300 · 27 Sep → 23 Oct · 2 sensors · 1 gap > 30 min (1.1 h in total) · 0 impossible values |
| Possible sensor artefacts | 15 jumps > 30 mg/dL within 2 min; 96 identical-value pairs < 30 s apart |
| Meals | 127 (7 without fat, 0 with unknown carbs) · 91 entered > 15 min after the time eaten (time is a parent's estimate) |
| Rapid doses | 95: meal 35, correction 35, both 17, purpose unset 8 |
| Treatments / finger-pricks | 50 / 33 (34 paired with CGM) |
| Exercise / sleep / illness | 0 / 1 / not captured |
| Tresiba | 11 U ×6, 10 U ×6, 9 U ×5, 8 U ×6, 7 U ×2 (daily, ~17:00) → settled nights: 3, 3, 2, 3, **0** |
| Frozen predictions | 153 (5 excluded), made under 5 different parameter sets (52 / 19 / 25 / 10 / 47) |
| Lab runs | 43 (42 ok), one code version |
| Edits / deletes | 28 edited, 9 deleted events (soft); 250 audit rows |

**Implication for Stage 3:** about 4 weeks of data. A held-out final week leaves about 30 meals for testing. That is
enough to rank simple models against "no change" and the trend, not enough to prove a personalised meal model. Results
must be reported with counts and intervals; a thin result keeps the baseline. The care-team parameters changed four times in this period, so results must also be split by parameter set.

## 4. Competitor and evidence check

| Product / source | Verified | Not verified / caution |
|---|---|---|
| Loop (loopdocs, prediction page) | Combines insulin, carbs, momentum (about 20 min) and retrospective correction (fades over 60 min); carbs start 10 min after entry; dynamic absorption from insulin counteraction with a minimum-rate floor; insulin over 6 h | Pump/automated delivery: not transferable to injections. Useful ideas: retrospective correction, minimum-rate floor |
| GlucoLab (myglucolab.com) | CGM/pump intake (Tandem, Nightscout, Dexcom), quick meal log, care-partner roles, PDF reports, AI weekly digest and meal score | **No forecasting claim** on its site; says informational only, not for dosing |
| mySugr predictions (Roche page) | Page blocked (403) during audit | Re-check before citing; do not claim horizons or minimums |
| Diabetes:M | Not re-checked in this audit | Treat the plan's description as unverified |
| Jade Diabetes (ManageBGL) | Company and press material claim forecasts hours ahead and dose coaching | **No independent validation found**; do not cite accuracy |
| ISPAD 2022 nutrition | Fat/protein delay and prolong the rise (about 3–6 h) | Does not support a fixed 40/60 split or fat ÷ 50 rule; ours stays an unvalidated display heuristic |
| Tresiba prescribing information | Steady state after 3–4 days; long half-life | Already used by Basal Check (`steadyDoses: 4`) |

## 5. How much of the plan exists

| Plan section | Done | Main gap |
|---|---|---|
| 1 Principles | ~80 % | Analysis still draws parts from older models (#2, #10) |
| 3 Audit | 100 % with this document | — |
| 4 Data model | ~70 % | per-reading quality flags, meal–dose link, `model_version`, effective-dated parameters, illness/stress tags, treatment purpose |
| 5A Meals | ~65 % | heuristic not tested on held-out meals; no uncertainty; rescue vs drink |
| 5B Rapid insulin | ~70 % | effect in mmol/L unvalidated; DIA to confirm with the care team |
| 5C Basal | ~85 % | one settling rule (#9); slope, minutes < 3.0, excluded-night counts in one table |
| 5D Influences | ~25 % | almost no exercise/illness/sleep data; pattern ranking with counts |
| 5E Forecast | ~40 % | 60/120/240 min, uncertainty bands, "not enough data" state |
| 6 Benchmark | ~35 % | horizons, ranges, missed-low and false-reassurance, strata, pre-agreed criteria |
| 7 UI | ~75 % | predicted-vs-actual panel in Analysis; end time as a range |
| 8 Sync | ~75 % | sync lag and quality per reading; written AI-photo privacy note |
| 11 Tests | ~55 % | Tresiba period separation, delayed/out-of-order imports, rollback |
| 12 Sign-off | ~10 % | this audit is part 2 of 7 |

## 6. Proposed next stages (no production change until final approval)

**Stage 1 — one additive migration** (no drops, nothing rewritten; rollback = drop the new columns/table):
`predictions.model_version` (existing rows = `v1-linear`); `events.purpose` for treatments (low / drink, unknown for
past rows); `events.meal_id` link for meal doses (filled only where unambiguous, the rest left empty); a
`param_history` table with effective dates (backfilled from the frozen predictions, marked approximate); event tags for illness
and stress; a read-only view with per-reading quality (gap, jump, warm-up, finger-prick disagreement).

**Stage 2 — consolidation** (#2, #9, #10, #17), no screen added, Analysis moved to the shared engine.

**Stage 3 — benchmark harness on a branch:** "no change", trend, current v1, Loop-style and similar-meal candidates;
30/60/120/240 min; MAE, median, 90th percentile; by range (< 3.9, 3.9–10, > 10) and by meal type; missed lows and false
reassurance; time-ordered with the last 7 days untouched. Then 2–4 weeks of shadow mode (forecasts stored, not shown).

**Stage 4–5:** UI from the same outputs, then one sign-off document and one approval.

**Needs the care team:** confirm DIA 240 min; agree the low-safety criteria for the benchmark before results are
seen; read the Tresiba step-down nights.
