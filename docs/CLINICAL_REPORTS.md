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

## Low and high events (`events.ts`): exact definition (report counts only)

The definition follows the 2023 consensus (Battelino et al., Lancet Diabetes Endocrinol 11:42). Each rule is pinned
by a test in `src/lib/__tests__/report.ts`.

| # | Rule | Exactly | Test |
|---|---|---|---|
| 1 | Minimum duration | An event starts after **15 consecutive minutes** beyond the limit. 14 minutes is not an event; 15 minutes is. | definition 1 |
| 2 | Recovery | An event ends only after **15 consecutive minutes** back on the other side. A bounce of up to 14 minutes stays inside the same event. | definition 2 |
| 3 | Missing data and sensor gaps | Two readings more than **16 minutes** apart are a gap. A gap ends an event at its last reading beyond the limit, and stops a run from becoming one. Events are never merged across a gap. | definition 3 |
| 4 | 16-minute tolerance | 15 minutes is the history-point interval. 1 extra minute allows for late arrivals: Gluroo's imported points are 15.1 minutes apart. The tolerance only decides what counts as continuous; it adds no values. | definition 4 |
| 5 | Last reading before a gap | Lasts only its own reading interval: 1 minute for live readings, 15 for history points. One low reading followed by a sensor drop-out is not counted as 15 minutes low. | "a gap breaks a run" |
| 6 | Levels | Low below 3.9 (70 mg/dL); very low below 3.0 (54); extended low below 3.9 for over 2 hours; high above 10.0 (180); very high above 13.9 (250). | level tests |
| 7 | Lowest or highest value | Always a real reading, never an average. | "a gap breaks a run" |

**Precision:** events are measured on the stored readings to the minute, not on 5-minute averages. Averaging
stretched a 12-minute dip to 15 minutes in her data.

**Independent of alerts and doses:** the live alerts (`supabase/functions/carb-glucose/alerts.ts`) and the dose
calculator do not use this code, and this code does not use theirs.

## No interpolation

- No glucose value is ever invented between readings.
- A stored reading stands for the time until the next reading, at most 15 minutes, which is the CGM's own history
  interval. Beyond that, time is missing and stays missing.
- **Grid:** a 5-minute slot needs half its time measured, or it is empty.
- **Daily profiles:** gaps are drawn as gaps.
- **AGP:** a time of day with no measured slot on any day is empty. The ±15-minute pooling only smooths times that
  have real data. Test: "no interpolation anywhere".

## Daily profiles

- Every day is drawn on the **same scale, 0–22 mmol/L**, so days can be compared at a glance. The same holds on the screen and in the PDF.
- A day without sensor data is drawn as a grey box saying "No sensor data". A partly measured day shows its % of sensor data.
- Gaps stay gaps: nothing is filled in.

## Weekly Summary (`weekly.ts`, `lib/weeklyPdf.ts`)

- **Layout:** one row per Kuwait day, 7 days per A4 page (LibreView's layout). It covers at most 14 days; a longer
  chosen period shows its last 14.
- **Chart:** the 24-hour glucose curve on 5-minute slots, on the same 0–22 mmol/L scale every day. Gaps stay gaps, and
  a day without data says so.
- **Above the curve:**
  - Carbs eaten, from meals confirmed as eaten. Meals within 20 minutes share one marker with their grams added.
  - A meal with unknown carbs makes its marker "?", never 0.
  - Low treatments, in red.
- **Below the curve:** insulin **given**, rapid and long-acting with units. The calculator's suggestions are never
  shown.
- **Finger-pricks:** marked at their values and kept out of every CGM number.
- **Day totals** come from the shared day rows (`days.ts`): average glucose, carbs (with the count of unknown-carb
  meals), insulin (rapid and long), and low events by the definition above, with the number of treatments. On
  28 Sep – 9 Oct 2026 these matched the independent SQL sums day by day.

## Patient details

- The date of birth stays labelled "approx." until someone ticks "Date of birth verified" in the patient details.
- Editing the date does not confirm it.

## Report periods

- A report covers whole Kuwait days ending at the last midnight. Today, still running, is left out. This gives fixed
  dates that can be matched with LibreView's report for the same dates.
- The periods offered are 7, 14 (default), 30 and 90 days.
- A standard AGP needs 14 days with ≥70% sensor data. Otherwise the report says why, and still shows the numbers,
  marked incomplete.

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
