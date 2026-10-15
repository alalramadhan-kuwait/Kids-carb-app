# Basal Check

Analysis → **Basal** (`/analysis?mode=basal`; the old `mode=night` link still opens it).
Engine: `src/engine/basalCheck.ts` (pure, tested in `src/lib/__tests__/run.ts`, "basal check").
Page: `src/pages/BasalCheck.tsx`. Data hook: `useBasalCheck()` in `src/lib/nightTresiba.ts` (45 days).

It describes how glucose behaves while Layan is fasting, at any hour, on each Tresiba dose.
It never proposes a dose, never calls a dose right or wrong, never sets a "safe" rate of fall,
never corrects or drops a sensor reading, and never calls a low false because no finger-prick was taken.

## What it replaced

| Before | Now |
|---|---|
| Analysis → Night page (`NightTresiba`), its night grid, onset chart, rate-per-dose chart and per-dose table | Basal Check page |
| Care-team page Overnight card (`components/Overnight.tsx`, overnight stretches only) | A link to Basal Check; the visit report carries the night part |
| Visit report: rate chart (`RatesChart`) and per-dose table (`PerDose`) | Basal Check dose comparison and factual summary |

Kept: the visit report's night grid, nights chart, before-juice table, finger-prick table and daily insulin
(moved to `src/pages/visit/`), the home "Last night" line, and `engine/basal.ts`, which the doctor reports and
the dose check still use.

## Fasting periods

Interruptions are food, carbs and treatments (including drinks logged as food that `juicesOf` infers to be
treatments) and NovoRapid. Between two interruptions there is at most one period.

- Starts 3 h after the last food or treatment, and 6 h after the last NovoRapid. If that leaves under an
  hour, it starts 3 h after NovoRapid instead and is marked **affected**. The model's insulin still active at
  the start is shown as an estimate.
- Ends at the next interruption. A juice ends it. Readings up to 5 min after the juice still count, because
  the juice is given on the reading that prompted it. Nothing later is used.
- **Night** = the period lies mostly between 12 and 6 AM; otherwise **Day**. Each period counts once.

| Status | When |
|---|---|
| Excluded | under 1 h, or no readings (listed, with the reason, never dropped) |
| Uncertain | under 70 % coverage, a doubtful dip (fast fall or V-shape, from `questioned`), a disagreeing finger-prick, or no Tresiba in the 30 h before |
| Affected | NovoRapid less than 6 h before, or exercise logged within 12 h |
| Clean | none of these |

Tresiba phase: doses 1–3 at new units are a **transition**, from the 4th on **stable**, and the first dose
in the record is **unknown**.

## Numbers

- Start and end are lightly smoothed (median of three).
- Change = end − start; per hour = change ÷ hours.
- Trend = Theil–Sen slope (a single odd reading cannot move it).
- Lowest and highest are raw readings.
- Minutes below 3.9, any reading below 3.0, and gaps of 20 min or more.
- Direction: falling or rising beyond ±1.7 mmol/L (30 mg/dL) over the period, otherwise stable. This is
  an informal basal-testing reference, not a medical limit.
- Lows: CGM runs under 3.9.
  - An episode lasts 15 min or more; runs of 5–14 min count as "shorter dips".
  - A low is confirmed when a finger-prick within ±15 min is under 3.9, "finger higher" when the prick is
    3.9 or more, and otherwise CGM only.
- Treatment evidence: a finger-prick in the 30 min before (or up to 5 min after) the treatment marks it
  confirmed or "finger not low". Without one it is "sensor under 3.9" or preventive.

## Dose comparison

Grouped by units and phase, in order of first use.
- Medians come from clean periods only.
- Fewer than 3 clean periods: **insufficient evidence** (dashed bar).
- Colours are neutral, so no dose is shown as approved.

## References

- ISPAD Clinical Practice Consensus Guidelines 2022, ch. 11: Abraham MB et al., *Pediatr Diabetes*
  2022;23:1322–1340. Level 1 hypoglycaemia is below 3.9 mmol/L; level 2 (clinically important) is below
  3.0 mmol/L.
- ISPAD 2022, ch. 8: de Bock M et al., *Pediatr Diabetes* 2022;23:1270–1276. Glucose target 3.9 (4)–10
  mmol/L. ISPAD 2018 gave a 4–8 fasting target. The 2022 chapter uses the unified 3.9–10 range; the app
  shows neither as a fasting rule.
- International consensus on CGM metrics (Battelino et al., *Diabetes Care* 2019; 2023 update): a CGM
  episode lasts at least 15 minutes.
- Tresiba (insulin degludec) prescribing information: steady state after 3–4 days; half-life about 25 h;
  in children, dose changes are spaced 3–4 days apart.
- ±1.7 mmol/L over a fasting test: an informal basal-testing reference from pump and insulin-management
  practice, not ISPAD.

No validated paediatric hourly rate-of-fall limit exists, and the app does not use one.

## Known limits

- No exercise has been logged so far, so activity cannot affect the classification yet.
- Most lows were not checked with a finger-prick. In Layan's data the sensor read lower than the finger
  in every pair under 8 mmol/L. The app shows this and does not correct for it.
