# Clinical report engine (doctor reports)

`src/engine/report/` computes every number on the doctor reports (AGP, Weekly Summary, Daily Log, Snapshot, and later
Mealtime Patterns and Monthly Summary). It is pure, tested (`src/lib/__tests__/report.ts`) and separate from the
live screens, the alerts and the dose calculator, which keep their own code and are not changed by it.

## Data

- **Glucose:** `carb.glucose_readings`, read as stored. Timestamps, values and sources are never changed. Finger-pricks
  (`events.kind = 'bg_check'`) are listed apart and never enter a CGM number.
- **Insulin:** only what was **given** (`events.insulin_units`, rapid or long). The calculator's suggestions
  (`events.dose_calc`, `planned_meals.calc_units`) are never added in.
- **Carbs:**
  - Food (confirmed meals plus carbs-only entries) and low treatments are counted apart.
  - A meal saved with carbs unknown counts as unknown, not 0.
  - A meal not yet confirmed as eaten is left out.
- **Period:** each report reads exactly its own period through `carb.report_data(from, to)` (draft in
  `supabase/drafts/report_data.sql`, to be applied with the first report screen). It never uses the app's 60-day,
  1,000-row cache, so 30- and 90-day reports are complete.
- **Days:** a day is a Kuwait day, 00:00–24:00 at UTC+3.

## Time weighting (`cgm.ts`)

The table mixes three kinds of reading: minute readings (LibreLinkUp live), 15-minute history points, and 5-minute
Gluroo imports. Every number is therefore weighted by time, not by count:

- A reading stands for the time until the next reading, at most 15 minutes. A longer gap is missing data and is never
  filled in.
- Mean, SD, CV, time in ranges and % sensor active come from that time line directly. They match the app's existing
  `carb.glucose_stats` to the decimal (validated 10 Oct 2026, below).
- Charts and the AGP use 5-minute slots cut from the same time line. A slot is measured when at least half of it
  (2.5 min) is covered, and its value is the time-weighted mean inside it.

## Metrics (`metrics.ts`)

| Metric | Definition |
|---|---|
| Time in ranges | <54, 54–69, 70–180, 181–250, >250 mg/dL. In mmol/L: <3.0, 3.0–3.8, 3.9–10.0, 10.1–13.9, >13.9. The labels are fixed text (`labels.ts`). |
| Time in tight range | 70–140 mg/dL, 3.9–7.8 mmol/L. |
| Mean, SD, CV | Time-weighted. SD is the population SD. CV = SD ÷ mean; ≤36% is stable. |
| GMI | 3.31 + 0.02392 × mean mg/dL. Shown only with ≥14 days and ≥70% sensor data. |
| % sensor active | Time with data ÷ time in the period (up to now). |
| Data sufficiency | ≥14 days and ≥70% sensor data, otherwise a stated reason. Reports show it; they never hide a number silently. |
| Targets shown | ISPAD 2024: in range >70%, <3.9 <4%, <3.0 <1%, >10.0 <25%, >13.9 <5%, tight range >50%. |

## AGP (`agp.ts`)

- The 5th, 25th, 50th, 75th and 95th percentiles at every 5 minutes of the Kuwait clock, as in the standard AGP.
- The old app chart used the 10th and 90th percentiles.
- Each measured slot is one value, so a day of minute readings does not outweigh a day of 15-minute points.
- Percentiles interpolate linearly between ranks (type 7).
- Light smoothing: each point pools the slots within ±15 minutes.
- A point resting on fewer than 5 different days is marked thin.

## Events (`events.ts`): report counts only

These follow the 2023 consensus (Battelino et al., Lancet Diabetes Endocrinol 11:42).

**Rules:**
- An event starts after ≥15 consecutive minutes beyond the threshold.
- It ends only after ≥15 consecutive minutes back. A shorter bounce does not split it.
- Missing data (no reading for over 16 minutes, which allows for the few seconds' lateness of history points) ends an
  event at its last reading.

**Levels:**
- Level 1 low: <70 mg/dL.
- Level 2 low: <54 mg/dL.
- Extended low: <70 for over 120 minutes.
- Level 1 high: >180 mg/dL.
- Level 2 high: >250 mg/dL.

**Precision:** events are measured on the readings to the minute, not on 5-minute averages. The lowest value shown is
a real reading. Before missing data, the last reading counts only for its own reading interval, so a single low
followed by a sensor drop-out is not 15 minutes low.

**Independent of alerts:** the live alerts on the phones (`supabase/functions/carb-glucose/alerts.ts`) are a separate
safety system. Their rules and timings are unchanged and are not used here.

## Differences from LibreView

| Topic | LibreView | This app | Why |
|---|---|---|---|
| CGM data used | 15-minute history data | Every stored reading, mostly 1-minute, weighted by time | More data; time weighting keeps the result comparable. Expect small differences (for example ±1 percentage point in time in range). |
| Low events | Below 70 mg/dL for longer than 15 minutes; no published end rule | 2023 consensus: ≥15 minutes; ends after 15 minutes back in range; level 2 counted apart | `libreViewLows()` reproduces LibreView's rule for comparison. On 28 Sep – 10 Oct 2026 both gave 9 lows. The app's old 10-minute rule gave 14. |
| AGP smoothing | Proprietary | Pooled ±15 minutes, linear percentiles | No published method to copy. Median and bands should look alike but will not match point for point. |
| Day boundary | The reader's time zone | Kuwait time | Same for this family. |
| Unknown-carb meals | Not a concept | Shown as unknown, never 0 | Avoids understating carbs. |

To validate against LibreView, export LibreView's 14-day AGP for the same dates and compare: % active, mean, GMI,
CV, the five ranges and the low-event count.

## Validation on stored data (10 Oct 2026, 28 Sep 00:00 – 10 Oct 22:00 Kuwait, 13,610 readings)

**5-minute grid against the original readings:**
- Measured minutes: 18,449.9 on the grid, identical to the readings.
- No slot was given a value without a reading in the 15 minutes before it.
- Slot value against the mean of its own readings: median difference 0.7 mg/dL, 95th percentile 6.2 mg/dL.
- Headline numbers from slots differ from the readings by at most 0.33 percentage points. Headline numbers are taken
  from the readings.

**Headline numbers:** the engine and the database (`carb.glucose_stats`) agree exactly:

| Measured min | Mean | SD | CV | <54 | 54–69 | 70–180 | 181–250 | >250 |
|---|---|---|---|---|---|---|---|---|
| 18,449.9 | 143.9 | 53.7 | 37.3% | 0.2% | 2.5% | 72.8% | 20.4% | 4.1% |

**AGP:** an independent Python recomputation matched all 288 × 5 points within 0.1 mg/dL (rounding).

**Day rows:** insulin given, treatments and food carbs matched independent SQL sums on all 13 days.
