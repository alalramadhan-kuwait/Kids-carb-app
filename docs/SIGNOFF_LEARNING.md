# Personalized Diabetes Learning System — sign-off package

Date: 23 October 2026 · Branch `audit/stage0` · App version proposed: **4.30.0** (live app still 4.29.0)
Companion documents: `docs/AUDIT_STAGE0.md` (Stage 0–2 detail) · `docs/signoff/screens-4.30.0.png` (screens)

This is the one approval request for the master plan. Nothing in the app the family uses has changed yet. The
database changes and the new server function are additive and already running, but they only store data and
measure: nothing they produce is shown to anyone except the new «Forecast vs what happened» card, which is part of
this release.

---

## 1. Competitor and evidence matrix

| Source | Verified | Unknown / caution | What we took |
|---|---|---|---|
| Loop (loopdocs, prediction) | Insulin + carbs + momentum (~20 min) + retrospective correction (fades over 60 min); carbs start 10 min after entry; dynamic absorption with a minimum-rate floor | Pump/automated delivery: not transferable to injections | Retrospective correction tested as candidate `v2rc` (result: worse, see §5) |
| GlucoLab | CGM/pump intake, quick meal log, care-partner roles, PDF reports, AI digest and meal score | **No forecasting claim** on its site; "informational, not for dosing" | Nothing new needed |
| mySugr predictions | Page refused access (403) during the audit | Horizons and data minimums not verified | Not cited |
| Diabetes:M | Not re-checked | Plan's description unverified | Not cited |
| Jade Diabetes | Company/press claims of forecasts hours ahead and dose coaching | **No independent validation found** | Not cited |
| ISPAD 2022 nutrition | Fat/protein delay and prolong the rise (≈3–6 h) | No fixed split | Fast/slow split kept as a **display estimate**, labelled so |
| Tresiba prescribing information | Steady state after 3–4 days | — | One settling rule: dose 4 onward is settled |

## 2. Audit, keep/consolidate matrix and migrations

Full inventory and the 19-row duplicate matrix: `docs/AUDIT_STAGE0.md` §1–2. Outcome:

| Item | Decision | Done |
|---|---|---|
| Active carbs / COB / «left» / widget | Keep one engine (`engine/absorb.ts`) | 4.29.0 |
| Linear carb lane | Removed; linear model kept only as the named `v1-linear` in frozen predictions and the lab | Stage 2 |
| Two Tresiba settling constants | One `STEADY_DOSES = 4` | Stage 2 |
| Home «≈ X at hh:mm» vs low alert | Hidden beside an open low alert (Stage 2), then held back altogether by the benchmark (Stage 4) | Stage 2, 4 |
| Treatment = rescue or drink | `treat_purpose = 'low'` from every low-treatment button; past rows left unknown | Stage 1, 2 |
| Care-team parameters with no dates | `param_history` (5 periods rebuilt from frozen predictions, marked approximate; every future change recorded by trigger) | Stage 1 |
| Insulin curve in two places | One import-free `engine/insulinCurve.ts`, used by the app and bundled into the server | Stage 3 |
| Widget's own JS model | Kept, with the parity test (Scriptable cannot import the app) | — |

Migrations (all additive; files in `supabase/migrations/` named with the recorded version):
`20261023050525_stage1_learning_foundation`, `20261023053015_stage3_benchmark_shadow`,
`20261023054045_stage3_service_grants`, `20261023055002_stage3_benchmark_schedule`.
No row of `events` or `meal_history` was rewritten (`entry_audit` unchanged at 250 rows by the migrations).

## 3. Architecture and source of truth

```
glucose_readings ─┐                           ┌─► Home card (arrow, 15-min change)      [measured]
events ───────────┼─► src/engine (pure, tested)┼─► absorption strip, active cards, COB   [estimate, labelled]
meal_history ─────┤    absorb · insulinCurve   ├─► Basal Check / Night (STEADY_DOSES)    [description]
param_history ────┘    iob · trend · benchmark └─► widget (JS copy, parity test)
                                │
                  scripts/bundle-benchmark.mjs (generated, drift check in `npm run build`)
                                ▼
          carb-benchmark (edge function, cron secret)
            every 15 min ─► forecast_shadow  (5 models × 4 horizons, never shown, never rewritten)
            daily 05:17  ─► benchmark_runs   (scores on the last 7 days) ─► «Forecast vs what happened» card
                                                                          └► gates: ONBOARD_VALIDATED,
                                                                             TREND_AHEAD_VALIDATED (both false)
dose calculator (dose.ts, useLiveDose) and alerts (carb-glucose/alerts.ts): unchanged, not connected to any of the above
```

Definitions: **logged carbs** = what was eaten (fact). **Carbs still to absorb** = estimate from the fast/slow curves.
**Insulin on board** (U) and **insulin activity** (U/h) are separate; **effect on glucose** (mmol/L) is only inside
the benchmark. **Tresiba** is a flat background band, never meal insulin.

## 4. Interface (existing screens only, no new page)

See `docs/signoff/screens-4.30.0.png`.

- **Home:** value, arrow and «−0.8 in 15 min» (measured). The «≈ 6.1 at 8:46» number and the dotted trend line are
  held back (§5). Absorption strip: fast light pink, slow dark pink, NovoRapid blue, Tresiba faint band; end times
  as ranges («12:40–3:30»).
- **Log › Note:** optional 🤒 Sick / 😟 Stressed.
- **Analysis › Prediction lab:** «Forecast vs what happened», refreshed daily.
- **Mom mode and the widget:** unchanged.

## 5. Benchmark (real data, test week 16–23 Oct 2026 held out)

Average miss in mmol/L, 646–660 forecasts per cell. ▲ = worse than «no change» with 95 % confidence (day-resampled).

| Ahead | No change | Trend (Home «≈») | v1 linear (current frozen) | v2 fast/slow | v2 + Loop correction |
|---|---|---|---|---|---|
| 30 min | **1.49** | 1.55 | 1.58 | 1.57 | 1.97 ▲ |
| 1 h | **2.27** | 2.33 ▲ | 2.44 | 2.39 | 3.00 ▲ |
| 2 h | **2.91** | 3.01 ▲ | 3.32 ▲ | 3.20 ▲ | 3.87 ▲ |
| 4 h | **3.19** | 3.28 ▲ | 3.66 ▲ | 3.58 ▲ | 4.22 ▲ |

- Trend direction on real moves (≥ 1 mmol/L) at 30 min: **52 %**, a coin flip.
- By situation: «no change» wins or ties after fatty meals, ordinary meals, fasting and at night. Only above
  10 mmol/L did v1 do better (60 min: 3.3 vs 3.8, n = 119): too little to act on.
- Error bands (10–90 %, from the training weeks) cover 77–85 % of test outcomes. They are wide: at 1 h about
  −3 to +4 mmol/L around the forecast.
- **Low safety: only 9 low readings in the test week.** No forecast can be judged for lows on this sample. Alerts
  keep their own validated logic.
- Knowledge cutoff: an entry logged after an origin is not used even if its time is earlier (tested).

**Conclusion:** no candidate passes the gate. Per the plan, the baseline stays and every forecast stays hidden. Shadow
mode now stores 80 forecasts an hour; the daily run re-scores as weeks accumulate.

Data coverage (Stage 0): 29,300 readings over 26 days, 127 meals (91 logged > 15 min late), 95 rapid doses, 0 exercise
entries, Tresiba 11 → 10 → 9 → 8 → 7 U in 4 weeks (7 U not yet settled).

## 6. Risks, pediatric safety, privacy, rollback

| Topic | Status |
|---|---|
| Dose calculator | **Unchanged** (`git diff main` on dose.ts, doseAt.ts, DoseCalculator, useLiveDose: empty). The insulin curve moved file unchanged; all dose tests pass |
| Alerts | **Unchanged** (carb-glucose, carb-activity: empty diff) |
| Removing «≈» | Removes a number that was no better than the current value; the arrow and alerts remain. Reversible with one constant |
| Fast/slow split | Still a heuristic, labelled «estimate» everywhere |
| Basal | Never suggests a dose. Tresiba stepping down weekly with large overnight drops is for the care team to read |
| Privacy | Server function writes only forecasts and summary numbers; data stays in the family's Supabase. The AI photo feature sends the food photo and an optional note (≤ 300 chars) with the family's own key; no name, glucose or dose |
| Rollback | App: redeploy 4.29.0. Database: drop `glucose_quality`, `forecast_shadow_scored`, the two cron jobs, `benchmark_runs`, `forecast_shadow`, `param_history`, `dose_meal_links`, the settings trigger and its function; drop `events.tags`, `events.treat_purpose`, `predictions.model_version`. No original record is lost. (Written, not executed.) |

## 7. Acceptance checklist and decision

- [x] One engine for carbs left, strip, cards, COB; widget parity test
- [x] 37 g with 32 g fat keeps 37 g; left never negative or above eaten (test)
- [x] Overlapping meals/doses counted once; deleted and pending excluded; rescue apart (test)
- [x] Actual injection time used; Tresiba excluded from meal insulin (test)
- [x] 7 U transition separated; 9 U history keeps its label (test)
- [x] Stale reading → no forecast; later-logged entry → not used (tests)
- [x] Benchmark at 30/60/120/240 min with test week held out, strata, low safety, intervals
- [x] Shadow mode running and immutable
- [x] No output proposes a dose; no accuracy claimed without proof
- [x] Dose calculator and alerts unchanged
- [x] 323 + 11 + 6 + 44 tests pass; i18n clean; build passes (with bundle drift check)
- [ ] Care team: confirm NovoRapid duration (240 min) and agree low-safety criteria before any forecast returns
- [ ] Enough low readings (≥ 20 in a test week) to judge forecasts during lows
- [ ] Rollback rehearsed on a database branch (not done: written only)

**Decision requested:** Approve releasing 4.30.0 to the family (merge `audit/stage0` into `main` and deploy), or
Changes required.
