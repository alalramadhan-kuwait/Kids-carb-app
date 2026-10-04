# Growth & nutrition — methods and sources

What the app calculates on the **Growth & nutrition** card (Now page) and page (`/growth`), which reference each
number comes from, and which thresholds are the app's own rules. It is a reference and pattern-detection tool: it
never changes a dose, never sets a calorie limit, and never suggests eating less. Decisions belong to the paediatric
diabetes team and dietitian.

Code: `src/engine/growth.ts`, `src/engine/who2007.ts`, `src/engine/energy.ts`, `src/engine/nutrition.ts` (pure,
tested in `src/lib/__tests__/run.ts` with synthetic data), wired up in `src/lib/growth.ts`.

## 1. Growth — WHO Growth Reference 2007 (5–19 years)

- **Data.** `src/engine/who2007.ts` holds the girls' L, M, S values by completed month, copied verbatim (by script, not
  by hand) from WHO's expanded z-score tables, downloaded 2026-10-04 from
  <https://www.who.int/tools/growth-reference-data-for-5to19-years/indicators>:
  BMI-for-age 61–228 months, height-for-age 61–228 months, weight-for-age 61–120 months (WHO gives weight-for-age
  only to 10 years). Boys' tables are not bundled; for a boy the app shows no percentile rather than a wrong one.
- **Reference.** de Onis M, Onyango AW, Borghi E, Siyam A, Nishida C, Siekmann J. Development of a WHO growth reference
  for school-aged children and adolescents. *Bull World Health Organ* 2007;85:660–7. doi:10.2471/BLT.07.043497
- **Age.** Months = days ÷ 30.4375. L, M, S are interpolated linearly between whole months.
- **z-score.** `z = ((y/M)^L − 1) / (L·S)`. Height-for-age uses it directly (L = 1). For BMI- and weight-for-age,
  beyond ±3 SD WHO's restricted method is used: `z = ±3 + (y − SD3) / (SD3 − SD2)` (WHO, *Computation of centiles and
  z-scores*, 2007).
- **Percentile** = standard normal CDF of z.
- **Cut-offs (WHO 2007, school age).** BMI-for-age: < −3 severe thinness, < −2 thinness, > +1 overweight, > +2 obesity.
  Height-for-age: < −2 short stature, < −3 severe. Adult BMI categories are never used.
- **BMI** = weight ÷ height². A weight without a height that day uses the latest height from the previous 120 days.
- **Chart curves:** the 3rd, 15th, 50th, 85th and 97th centiles (z = ±1.881, ±1.036, 0).

### Growth status — APP RULES (configurable in `GROWTH_RULES`, not WHO standards)

| State | When |
|---|---|
| Establishing baseline | Fewer than two measurements at least 90 days apart |
| Stable | A trajectory exists and none of the rules below fire |
| Worth a look | BMI-for-age < −2 or > +2, or height-for-age < −2 (WHO cut-offs, from the first measurement); BMI- or height-for-age z fell ≥ 0.67 (≈ one major centile line) within the last year across ≥ 90 days; weight ≥ 3 % lower than a weight 60–365 days earlier; no height gain in 180 days; a height lower than the previous one by more than 1 cm (likely an entry error) |

Weight changes over 7, 30 and 90 days are **shown only**; they never raise a status. Before saving, a change of more
than max(1.5 kg, 0.05 kg/day) or a height drop asks for confirmation.

## 2. Energy — NASEM 2023 Estimated Energy Requirement

- **Reference.** National Academies of Sciences, Engineering, and Medicine. *Dietary Reference Intakes for Energy.*
  Washington, DC: The National Academies Press; 2023. doi:10.17226/26818. Chapter 5, Table 5-5.
- **Equations, girls 3.0–18.99 y** (age y, height cm, weight kg), plus energy deposited in growth:

| Activity | EER (kcal/day) |
|---|---|
| Inactive | 55.59 − 22.25·age + 8.43·height + 17.07·weight + growth |
| Low active | −297.54 − 22.25·age + 12.77·height + 14.73·weight + growth |
| Active | −189.55 − 22.25·age + 11.74·height + 18.34·weight + growth |
| Very active | −709.59 − 22.25·age + 18.22·height + 14.25·weight + growth |

- Growth term (girls): +15 kcal/d at 3–8.99 y, +30 at 9–13.99 y, +20 at 14–18.99 y.
- **Range shown:** EER ± 221 kcal/d, the standard error NASEM reports for the girls' equation (Active, at the sample
  mean of 9.6 y, 135 cm, 37.6 kg). It is a reference band, not a target or limit.
- Inputs update automatically from the latest weight, height, age (from birth date) and the chosen activity level. If
  no activity level has been chosen, *Active* is assumed and labelled as assumed.
- A dietitian's energy figure (Profile & targets) replaces the EER; its band is ± 10 % (app rule).
- **Worked check (synthetic example):** 7.0 y, 124 cm, 23 kg → Inactive 1353, Low active 1484, Active 1547, Very active 1737 kcal/d.

### Energy status (7-day and 30-day averages)

- **Intake** = food + low treatments. Low treatments (`treatment` events) count as carbohydrate only: kcal = 4 × g.
- *Within estimate* / *below* / *above* the band; *not enough days* when fewer complete days than required, or food
  energy coverage below the threshold. "Above" is shown neutrally and never as a problem; "below" is amber.
- ISPAD 2022 notes population references can over- or underestimate an individual child's needs; growth is the
  deciding signal.

## 3. Type 1 diabetes nutrition context — ISPAD 2022 and ADA 2026

- **ISPAD.** Annan SF, Higgins LA, Jelleryd E, et al. ISPAD Clinical Practice Consensus Guidelines 2022: Nutritional
  management in children and adolescents with diabetes. *Pediatr Diabetes* 2022;23(8):1297–1321. doi:10.1111/pedi.13429
  - Box 1, as a guide: carbohydrate 40–50 % energy, fat 30–40 % (saturated + trans < 10 %), protein 15–25 %. ISPAD
    states the optimal distribution is individual. The app shows these as **context** (within / below / above
    reference), never as pass or fail, and never suggests cutting carbohydrate; ISPAD warns that very low
    carbohydrate diets in young people can be nutritionally inadequate and impair growth.
  - Box 3, fibre: 14 g per 1000 kcal, or the alternative for children over 2 years, age + 5 g/day. The app uses
    **age + 5 g/day** as its minimum.
- **ADA.** American Diabetes Association Professional Practice Committee. 14. Children and Adolescents: Standards of
  Care in Diabetes—2026. *Diabetes Care* 2026;49(Suppl 1):S297–S320. doi:10.2337/dc26-s014
  - 14.2 individualized nutrition with more non-starchy vegetables, whole fruits, legumes, whole grains, nuts and seeds
    and low-fat dairy, and fewer sugar-sweetened beverages, sweets, refined grains and processed foods → the food-group
    view.
  - 14.4 meal composition affects post-meal glucose; high-fat and high-protein meals may need insulin adjustment → the
    "Meal composition" count (pattern only; insulin decisions stay with the diabetes team). "High fat or protein" uses
    the app's existing rule `isFatty`: fat ≥ 15 g or fat + protein ≥ 200 kcal (`src/engine/iob.ts`).
  - 14.5 periodic assessment by a paediatric diabetes dietitian of eating pattern against weight status and growth →
    the dietitian targets and the dietitian sheet.

## 4. Nutrient references (girls; replaced by any dietitian target)

| Nutrient | Reference used | Kind | Source |
|---|---|---|---|
| Carbohydrate | 40–50 % of energy | context | ISPAD 2022 Box 1 |
| Fat | 30–40 % of energy | context | ISPAD 2022 Box 1 |
| Saturated fat | < 10 % of energy | limit | ISPAD 2022 |
| Protein | ≥ 0.95 g/kg/day | minimum | IOM 2005 RDA (4–13 y) |
| Fibre | ≥ age + 5 g/day | minimum | ISPAD 2022 Box 3 |
| Added sugars | < 10 % of energy | limit | Dietary Guidelines for Americans 2020–2025 |
| Sodium | ≤ 1500 mg (4–8 y), 1800 (9–13 y) | limit | NASEM 2019 CDRR |
| Potassium | ≥ 2300 mg | minimum | NASEM 2019 AI |
| Calcium | ≥ 1000 mg (4–8 y), 1300 (9–13 y) | minimum | IOM 2011 RDA |
| Vitamin D | ≥ 15 µg (600 IU) | minimum | IOM 2011 RDA |
| Iron | ≥ 10 mg (4–8 y), 8 (9–13 y) | minimum | IOM 2001 RDA |

No references are bundled outside 4–13 years.

## 5. Data quality — missing is never zero (APP RULES, configurable)

- A logged meal stores each nutrient total only when **every** ingredient's label gives it; otherwise that total is
  null (unknown). The same holds for the seven newer nutrients (saturated fat, added sugar, sodium, calcium, iron,
  potassium, vitamin D), which are optional label fields on products.
- **Coverage** of a nutrient = the share of the period's food energy coming from entries that have that nutrient. An
  entry with no calorie figure is weighed as carbs × 4 ÷ 0.45 (the middle of ISPAD's 40–50 %).
- **Estimate** = known amount ÷ coverage.
- Minimums: *Adequate* as soon as the known amount reaches the reference (the rest can only add); *Low* only when
  coverage ≥ threshold and the estimate is below; otherwise *Not enough data*.
- Limits: *High* once the known amount alone exceeds the limit; *Within* when coverage ≥ threshold; otherwise *Not
  enough data*.
- Coverage threshold: **80 %** by default, editable under Profile & targets (50–100 %). It is an app rule, not a
  medical standard.
- **Complete day:** at least 3 food entries; today is never complete. 7-day status needs ≥ 3 complete days, 30-day
  ≥ 7. Entries set aside as possible duplicates (`needs_review`) are excluded.
- **Low treatments** count toward energy eaten but are excluded from every nutrient, percentage and food-group figure.
- Carbs logged alone (`carbs` events) count as food with only their carbohydrate known.

## 6. Food groups

Product categories map once to a group (`CATEGORY_GROUP` in `src/engine/nutrition.ts`); a product can override its
group. Groups shown: vegetables, fruit, grains & starches, protein foods, dairy; plus the share of carbohydrate from
sweets, sugary drinks and processed snacks. A meal whose lines cannot all be classified (e.g. a name-only import)
counts as unclassified. "Few vegetables / few fruit" = present on fewer than half of complete days (app rule).

## 7. What is shown first

The page answers four questions before anything else, for the chosen window (**3 days** by default, or 7 / 30):

1. **Energy** — total intake (food + low treatments) as kcal/day, with a bar showing the estimated range and a dot
   for her average; "within / below / above range".
2. **Carbs, protein, fat** — one mark each (✓ within, ↑ / ↓ outside). A share within 5 percentage points of the
   ISPAD range reads "slightly high / low" (app rule, `slightlyPts`). Protein is "low" only below 0.95 g/kg/day;
   protein above 25 % of energy is not flagged.
3. **Growth** — "within expected range" when no WHO cut-off or trajectory rule fires; weight, height and BMI with
   their percentiles.
4. **Anything worth a look** — growth reasons and balance issues, in amber.

**Data quality** = the lowest of energy, fat and protein coverage for the window. Nutrients without enough label
data are collapsed under "Other nutrients"; references, the activity choice and sources sit under "How targets are
calculated"; food groups and high-fat / high-protein meals under "Meal patterns". The 3-day window needs at least 2
complete days, 7 days at least 3, 30 days at least 7.

## 8. Card on Now

Three lines from the 3-day average, each with a green / amber / red dot (grey = not enough data yet):

| Line | Green | Amber | Red |
|---|---|---|---|
| Growth | no rule fires ("On track") | WHO BMI > +2 SD, height < −2 SD, height not increasing, a likely entry error | WHO thinness, weight down ≥ 3 %, a 0.67 z drop in BMI- or height-for-age |
| Energy | total intake inside the estimated range | above the range, or up to 10 % below its lower edge | more than 10 % below the lower edge |
| Nutrition | carbs, protein and fat all within | any of them outside, or a balance issue | — |

The energy verdict follows the estimated **range**, never the midpoint: the kcal/day and the % difference from the
estimate are shown beside it as plain numbers. The single most important balance issue, or else "Some nutrient data
missing", is a small line under the three; missing data is never a status of its own. Red/amber thresholds for the
card are app rules.
