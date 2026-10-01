# Glucose monitoring plan — وجباتنا

A complete plan for adding glucose monitoring for one child with Type 1 diabetes to this app, written so a
developer can build from it directly.

**Ground rules (apply to every feature below)**

1. The app **organises and explains**. It never recommends, calculates or changes an insulin dose, and it
   never tells anyone how many grams to treat with. Where action may be needed it says so and shows the
   family's own written care plan (entered by the parents from the clinic).
2. **Every medical number is entered by the parents** (target range, alert thresholds, care plan). The only
   built-in numbers are the international *reporting* bands used for Time in Range, and they are labelled as
   reporting bands, not as her targets.
3. **Our alerts are a second line.** A web app cannot guarantee a sound at 3 a.m. The Libre app (and Gluroo,
   if used) stay the primary alarm. We add what they miss: context, coordination between parents, and the
   "no data" alert that Libre followers do not get.
4. **Never hide uncertainty.** Old readings, gaps, warm-up, and insufficient data are always shown as such,
   never smoothed over or interpolated.
5. **Little text on everyday screens.** Numbers, arrows and short labels. All calculations, analysis and
   engineering detail live in the **التحليل (Analysis, formerly متقدم)** tab (sections 10 and 11).

---

## 1. What the leading apps do — and where they fall short

| App | Best ideas to take | Weaknesses to avoid |
|---|---|---|
| **Gluroo** | One shared event log for the whole family ("GluCrew"); quick shorthand logging; *coordinated* notifications — the profile owner is alerted first, others only if needed; daily view and heads-up display; works as a Nightscout endpoint. | Chat-style log mixes conversation and data; many settings; AI photo carb *estimates* conflict with our "only the label" rule. |
| **Dexcom G7 / Follow** | The clearest alert taxonomy in the industry: Urgent Low (55 mg/dL, cannot be turned off), *Urgent Low Soon* (predicted ≤55 within 20 min), Low, High, Rise rate, Fall rate (2 or 3 mg/dL/min), Signal Loss. Quiet mode keeps urgent alerts on. Followers choose their own notifications per person. | Followers see numbers without context: no meals, no insulin, no notes. |
| **FreeStyle Libre / LibreLinkUp** | Simple; followers get the reading, trend arrow, and high/low alarms. | Followers of Libre 2/3 do **not** get signal-loss alarms; limited history and context. |
| **mySugr** | Fast logbook entry, photos per entry, clean daily analysis, PDF/CSV/Excel reports, estimated HbA1c only after enough data (3 readings/day for 7 days). | Logbook-first, CGM is secondary; reports and PDF behind a paywall; gamification. |
| **Nightscout** | Open data model; careportal for treatments; AR2 forecast; any number of caregivers can watch. | Do-it-yourself and technical; alarms only while the page is open. |
| **Sugarmate** | Escalation through a **phone call** for urgent lows — reaches a sleeping parent when a push does not. | Separate app; no meal context. |
| **AGP / international consensus** | One-page Ambulatory Glucose Profile; standard metrics: TIR 70–180 mg/dL (> 70%), below 70 (< 4%), below 54 (< 1%), above 180 (< 25%), above 250 (< 5%), CV ≤ 36%, GMI from mean glucose; needs ≥ 70% of 14 days of data. | Built for clinic visits, not for a parent at 2 a.m. |

**What we do better** (the workflow none of them combine):

- **One status sentence** at the top ("Stable, in range", "Low and falling — see care plan") instead of a
  number the parent must interpret.
- **Context is attached to the number**: the last meal, last insulin and who gave it, and the time since
  each, right under the reading. Most apps make you scroll a log to find this.
- **"Handled by" acknowledgement.** When an alert fires, the first parent to tap "I'm on it" silences it for
  everyone else and the others see "Mum is handling it". This prevents the real risk of two parents both
  treating the same low.
- **Duplicate guard** on insulin and carbs ("Dad logged 4 u three minutes ago — is this the same dose?").
- **Meals are tied to our own recipes**, so the app can say "Chicken majboos usually rises +3.4 mmol/L, peak at
  1 h 10 min (6 times)". No other app links glucose response to a family's own label-verified recipes.
- **Gaps are first-class**: "No data for 25 min — check the phone near her" is an alert in its own right.

---

## 2. What a parent needs in five seconds

| Question | Where the Home screen answers it |
|---|---|
| What is her glucose now? | Big number, unit, and age ("2 min ago"). Greyed and labelled if older than 10 min; replaced by "No recent reading" after 20 min. |
| Rising, falling, or stable? | Trend arrow plus words ("falling fast"), computed rate in tooltip. |
| Is action required? | Status sentence and colour; an active-alert strip with who is handling it; a button to the family's care plan. |
| What happened before the change? | Context lines: last meal (name, carbs, time since), last insulin (units, type, time since, by whom), activity/notes in the last 4 h. Markers on the 3-hour graph. |
| Was insulin given? | "Last insulin" line; if a meal was logged with no insulin within the parent-set window, a neutral reminder: "No insulin logged for lunch — log it if given." |
| Was food eaten? | "Last meal" line linked to the meal entry and recipe. |
| Is there a repeated pattern? | One insight card at most on Home ("Lows after 10 p.m. on 3 of the last 7 nights"), full list in Trends. |
| Is today unusual? | "Today vs her normal" chip: time below/above range today compared with her 14-day typical band. |

---

## 3. Feature catalogue

Each feature: **what** · **why** · **data** · **where** · **what the user sees** · **alerts/actions** · **phase**.
Phases are defined in section 7.

### 3.1 Live reading & freshness
- **What:** current glucose, unit, age, data source.
- **Why:** the first question every time.
- **Data:** `glucose_readings`, `cgm_state`.
- **Where:** Home (top), Night mode, School view.
- **Sees:** big number; "2 min ago"; greyed at > 10 min; "No recent reading (last 7.4, 26 min ago)" at > 20 min.
- **Alerts:** "No data" alert (3.6).
- **Phase:** 1 (partly built; needs server polling so data keeps flowing when the app is closed).

### 3.2 Trend arrow & rate
- **What:** direction and speed of change.
- **Why:** 6.0 and falling fast needs a different response from 6.0 and steady.
- **Data:** LibreLinkUp `TrendArrow` for the current reading; computed slope from the last 15 min otherwise.
- **Where:** next to the number everywhere it appears.
- **Sees:** ⇊ ↘ → ↗ ⇈ plus words ("falling fast"); rate in mmol/L per 5 min on tap.
- **Alerts:** rapid rise / fall (3.7).
- **Phase:** 1.

### 3.3 Glucose graph with events
- **What:** line graph with the parent's target band shaded and markers for meals 🍽, insulin 💉,
  treatment 🧃, activity 🏃 and notes 📝; tap a point for context.
- **Why:** shows cause and effect at a glance.
- **Data:** readings, events, gaps.
- **Where:** Home (3 h), Timeline (3/6/12/24 h), Daily view (00:00–24:00).
- **Sees:** gaps drawn as breaks, never joined; warm-up periods hatched.
- **Phase:** 1 (Home 3 h + Timeline 24 h), 2 (Daily view, zoom).

### 3.4 Time in Range & daily summary
- **What:** % time in five reporting bands (< 54, 54–69, 70–180, 181–250, > 250 mg/dL), mean, CV, data
  coverage; separately, % within *her* parent-entered target.
- **Why:** the standard way clinics measure control; parents see whether today was typical.
- **Data:** readings, `daily_stats`.
- **Where:** Home (today's single line), Daily view, Reports.
- **Sees:** stacked bar; "Not enough data" when coverage < 70% for the period.
- **Phase:** 1 (today on Home), 2 (Daily/Reports).

### 3.5 Low & high alerts (incl. urgent low)
- **What:** alerts at parent-set thresholds; urgent low cannot be switched off.
- **Why:** core safety, as a second line to Libre.
- **Data:** readings, `alert_rules`, `alerts`, push subscriptions.
- **Where:** pushed to phones; active strip on Home; Alerts screen.
- **Sees:** "Low 3.6 ↘ — 4 min. Care plan →"; buttons *I'm on it*, *Treated*, *Snooze*.
- **Logic:** section 6.
- **Phase:** 1.

### 3.6 No data / sensor problems
- **What:** alert when no new reading for a parent-set time (suggest 20 min, matching Libre's own signal-loss
  timing); sensor warm-up, sensor ending (24 h and 2 h before), connection errors from LibreLinkUp.
- **Why:** Libre followers do not get signal-loss alarms; a silent screen at night is the most dangerous state.
- **Data:** `cgm_state` (last reading time, sensor activation time, last error), readings.
- **Where:** Home status sentence, push, Alerts.
- **Phase:** 1 (no data), 2 (sensor lifecycle).

### 3.7 Rapid rise / fall
- **What:** alert when the computed rate exceeds a parent-set value (offer 2 or 3 mg/dL/min, as Dexcom does).
- **Why:** an early warning before the threshold is crossed.
- **Data:** readings (≥ 3 points in 15 min, no gap).
- **Phase:** 2 (needs 1-minute data from server polling to be reliable).

### 3.8 "Low soon" projection
- **What:** linear projection 20 min ahead; alert if projected ≤ urgent-low threshold.
- **Why:** time to act before the low (Dexcom "Urgent Low Soon").
- **Wording:** "may go low within 20 min", never "will".
- **Phase:** 3, behind a setting; only after 3.7 has run reliably for weeks.

### 3.9 Insulin entries (logging only)
- **What:** record units, insulin type (rapid / long), time, who gave it, optional note.
- **Why:** answers "was insulin given?" and gives context to every rise and fall.
- **Data:** `events` (kind = insulin).
- **Where:** Home "+ Log", Meals & Insulin, Timeline.
- **Sees:** "4 u rapid · 13:05 · Mum". **No calculator, no suggestion.** Insulin-on-board appears only in the Advanced tab (section 10.9).
- **Alerts:** duplicate guard (3.15); optional neutral "meal logged, no insulin logged" reminder.
- **Phase:** 1.

### 3.10 Carbs & meals
- **What:** reuse the existing "اخترناها" flow; also a quick "carbs only" entry and a "hypo treatment" entry
  (juice, glucose tablets) which counts as carbs but is shown differently.
- **Why:** meals are already the heart of this app; linking them to glucose is our strength.
- **Data:** `meal_history` (existing) + an `events` row that points to it.
- **Sees on the timeline:** "Chicken majboos 48 g · +3.4 after 1 h 10 min".
- **Phase:** 1 (link), 2 (per-recipe response).

### 3.11 Activity / exercise
- **What:** type, duration, intensity (light/moderate/hard), time.
- **Why:** explains lows hours later, especially overnight after sport.
- **Data:** `events` (kind = activity). Manual only: a web app cannot read Apple Health.
- **Phase:** 2.

### 3.12 Notes & events
- **What:** free notes plus quick tags: sick, sensor change, site change, school trip, party, stress.
- **Why:** "what happened before the change" is often not food or insulin.
- **Data:** `events` (kind = note, tag).
- **Phase:** 1 (note), 2 (tags).

### 3.13 Night mode
- **What:** dark, very large number and arrow, status sentence, last-hour graph; optional "keep screen on"
  (Screen Wake Lock, where the phone supports it); night alert profile active by schedule.
- **Why:** a parent checking at 3 a.m. should read it without glasses or brightness.
- **Morning:** "Overnight: in range 92%, lowest 4.4 at 03:10, no alerts."
- **Phase:** 2.

### 3.14 School mode
- **What:** schedule (e.g. Sun–Thu 07:00–14:00); school profile for alerts; optional read-only link for the
  school nurse with only the number, arrow, age and care plan; quick-log for school ("snack eaten",
  "treated low"); a handover summary at pickup.
- **Why:** parents lose visibility at school; the nurse needs a minimal, unambiguous view.
- **Phase:** 2 (schedule + summary), 3 (nurse link with logging).

### 3.15 Duplicates & deletions
- **What:** idempotency key per submission (double-tap safe); soft warning for similar entries within
  10 min; soft delete with 10-second Undo and an audit trail; reports exclude deleted entries.
- **Why:** two caregivers logging the same dose leads to wrong history and wrong decisions.
- **Phase:** 1.

### 3.16 Multiple caregivers & roles
- **What:** roles: Parent (everything), Caregiver (log + view + alerts), Viewer (view only), School (time-boxed).
  Each person chooses which alerts reach them and their quiet hours (urgent low and no-data cannot be quieted
  at night).
- **Escalation:** first notify the on-duty person; if not acknowledged in N min, notify the next; then all.
- **Phase:** 1 (members + "handled by"), 2 (roles, escalation).

### 3.17 Data sharing & export
- **What:** read-only links with expiry (school, grandparents, clinic); CSV export; PDF clinic report.
- **Phase:** 2 (CSV, links), 3 (PDF).

### 3.18 Reports (daily, weekly, monthly)
- **What:** TIR bands, mean, CV, GMI (labelled "estimate, not a lab HbA1c", only with ≥ 14 days and ≥ 70%
  coverage), hypo episodes (count, total time, night vs day), highest/lowest, carbs per day, insulin entries
  per day, data coverage; an AGP-style percentile chart (median, 25–75, 5–95 by time of day).
- **Phase:** 2 (weekly/14-day), 3 (monthly, PDF).

### 3.19 Pattern detection
- **What:** plain-language insights from fixed, explainable rules (section 5.6), each with its evidence
  ("3 of the last 7 nights") and a "dismiss" button.
- **Why:** parents need repeated problems surfaced, not a dashboard.
- **Never:** "reduce/increase her dose". Only "discuss with her clinic" for repeated lows/highs.
- **Phase:** 2 (time-of-day lows/highs, meal response), 3 (unusual-day).

### 3.20 Care plan
- **What:** the family's written plan from the clinic (hypo steps, hyper steps, sick-day rules, contacts),
  entered as text by a parent.
- **Why:** the alert can show *their* doctor's instructions instead of the app inventing advice.
- **Where:** linked from every alert, Home, School view.
- **Phase:** 1.

---

## 4. Screens

Bottom navigation (5 tabs, parent-first):

**الآن (Now)** · **السجل (Timeline)** · **الوجبات (Meals)** · **التحليل (Analysis — formerly متقدم)** · **المزيد (More)**

Recipes, Products and the meal planner move under *Meals*; the current *History* becomes part of *Timeline*.

### 4.1 Home / Live Glucose (الآن)
```
┌─────────────────────────────────────────┐
│ ● Stable, in range                       │  ← status sentence, coloured only if out of range
│ 6.2  →  mmol/L                 2 min ago │
│ ╭─ 3-hour graph with 🍽 💉 markers ──────╮ │
│ ╰──────────────────────────────────────╯ │
│ 🍽 Chicken majboos · 48 g · 1 h 20 ago    │
│ 💉 4 u rapid · 1 h 35 ago · Mum           │
│ [ + Log ]   insulin · carbs · treatment · note │
├─────────────────────────────────────────┤
│ Alerts: none     /  "Low 3.6 ↘ — Dad is on it ✓" │
│ Today: 78% in range · 0 lows · data 96%  │
│ Insight: lows after 22:00 on 3 of 7 nights │
└─────────────────────────────────────────┘
```
Rules: one screen, no scrolling needed for the first five lines; nothing red unless out of the parent range
or an alert is active.

### 4.2 Glucose Timeline (الخط الزمني)
24-hour scrollable graph on top, chronological list below mixing readings milestones (crossed into low, peak),
meals, insulin, activity, notes, alerts and acknowledgements. Tap any point or entry: a context card with the
4 hours before it. Filters: all / food / insulin / alerts.

### 4.3 Daily View
Pick a date. Graph 00:00–24:00 with target band and her 14-day typical band (median and 25–75) behind it;
TIR bar; episodes; all entries; "compared with her normal" line. Swipe between days.

### 4.4 Meals & Insulin (الوجبات)
Existing Today suggestions, recipes and products, plus: "Log insulin", "Log carbs only", "Hypo treatment".
Each recipe page gains a "How she responds" card (median rise, time to peak, number of times, last 5 curves
overlaid) once there are ≥ 3 logged meals with complete glucose data.

### 4.5 Alerts
Active alerts with *I'm on it / Treated / Snooze*; history with who acknowledged what and when; settings per
profile (Day / Night / School) and per person.

### 4.6 Advanced (متقدم) — trends, patterns, reports and calculations
One tab for everything analytical, so the other tabs stay short. Top screen: six summary groups; tap any
number for its full analysis. Reports (day / week / month, CSV, clinic PDF) and the AGP chart live here too.
Full specification in section 10; the interactive graph experience (Live · Day · Patterns · Meals ·
Compare) in section 11. The tab is renamed **التحليل**.

### 4.7 Reports
Inside Advanced: Day / Week / Month / custom; metrics from 3.18 and section 10; export CSV; PDF for the clinic
(Phase 3).

### 4.8 School Mode
Schedule, who is the school contact, what the school sees; at pickup: "School day: lowest 4.1 at 10:20,
snack 15 g at 10:30, in range 85%".

### 4.9 Night Mode
Dark full-screen live view; schedule; morning summary card on Home.

### 4.10 Caregiver Sharing
Members, roles, invite by email, escalation order, read-only links with expiry and revoke.

### 4.11 Settings
Units; target range (parent/clinic); alert thresholds and profiles; care plan; data source and sensor;
time zone (Asia/Kuwait); export; delete data.

---

## 5. Main calculations

All glucose values are stored in mg/dL as integers and converted for display (mmol/L = mg/dL ÷ 18.016,
one decimal). All "day" boundaries use **Asia/Kuwait** local time.

### 5.1 Freshness
`age = now − latest.taken_at` → *fresh* ≤ 10 min · *old* 10–20 min (grey) · *stale* > 20 min (no big number).

### 5.2 Trend
If the latest reading has a LibreLinkUp `TrendArrow`, use it. Otherwise least-squares slope over readings
from the last 15 min (≥ 3 points, no gap): |slope| < 1 mg/dL/min steady; 1–2 rising/falling; 2–3 fast; > 3
very fast.

### 5.3 Gaps
A gap is any interval between consecutive readings > 20 min (history points from LibreLinkUp come every
15 min, live points every minute). Gaps are stored or computed per query and always drawn as breaks.

### 5.4 Time-weighted metrics
Each reading represents the time until the next reading, **capped at 15 min**, so a gap is not counted as
time in any band. Coverage = covered time ÷ period length. Metrics are shown only if coverage ≥ 70%.
- Bands (mg/dL): very low < 54 · low 54–69 · in range 70–180 · high 181–250 · very high > 250.
- Mean, SD, **CV = SD / mean** (consensus target ≤ 36%).
- **GMI (%) = 3.31 + 0.02392 × mean mg/dL** — only for ≥ 14 days with ≥ 70% coverage, labelled as an estimate.
- Personal "in target" uses the parent-entered range.

### 5.5 Episodes
Hypo episode: ≥ 15 consecutive minutes < 70 mg/dL; ends after ≥ 15 minutes ≥ 70. Level 2 if any value < 54.
Hyper episode: ≥ 15 minutes > 250 mg/dL. Night = 00:00–06:00 local.

### 5.6 Meal response (per meal, then per recipe)
Baseline = reading within ±10 min of the meal time; peak = maximum in the next 3 h; Δ = peak − baseline;
time to peak; value at 2 h. Valid only if there is no gap in the 3 h and no second meal within 2 h. Per recipe:
median Δ and median time to peak, shown with n; hidden while n < 3.

### 5.7 Patterns (explainable rules)
- **Recurring lows by time of day:** ≥ 3 hypo episodes starting in the same 2-hour window within 14 days.
- **Recurring highs after a recipe:** median Δ of that recipe above a parent-set value with n ≥ 3.
- **Overnight drift:** median change 00:00 → 06:00 over the last 7 nights beyond a set value.
- **Unusual day:** today's time below range (or above range) above her 90th percentile of the last 14 days.
Every insight stores its evidence and is dismissable; none suggests a dose change.

### 5.8 Context window ("what happened before")
For any time *t*: events in [t − 4 h, t], plus last meal, last insulin, last activity, with "time since".

### 5.9 Duplicate detection
Same kind within 10 min and (insulin: same units; carbs: within ±10%) → confirmation dialog naming who logged
the first. Every submission carries a client UUID; the database rejects a second insert with the same UUID.

---

## 6. Alert logic

**Delivery (be honest about limits):**
1. In-app banner and sound when the app is open.
2. Web Push to phones that installed the app to the home screen (iOS 16.4+). It cannot bypass silent mode or
   Focus, and is not guaranteed to arrive. Our alerts are therefore labelled "companion alerts".
3. Phase 3 option: a phone call (as Sugarmate does) for unacknowledged urgent low / no data at night, through
   a paid voice service.

**Evaluation:** server side, every minute (pg_cron → edge function), never only in the browser.

**State machine per alert kind:**

```
inactive ──condition holds for D min──▶ active ──notify──▶ notified
notified ──"I'm on it"──▶ acknowledged (others see who) ──snooze S min──▶ re-check
notified ──no ack for R min──▶ re-notify; after E min ──▶ escalate to next caregiver, then everyone
any ──condition false for H min with hysteresis──▶ resolved (logged, notification "back in range")
```

| Kind | Condition (parent-set values) | D (delay) | Hysteresis to resolve | Can be silenced? |
|---|---|---|---|---|
| Urgent low | ≤ urgent threshold | 0 | ≥ threshold + 10 for 10 min | Never |
| Low | ≤ low threshold | 5 min | ≥ low + 10 for 15 min | Snooze only |
| High | ≥ high threshold | 30 min (avoid fatigue) | ≤ high − 20 for 15 min | Yes (quiet hours) |
| Rapid fall / rise | |rate| ≥ set rate | 2 readings | rate back below | Yes |
| Low soon (Ph. 3) | projection ≤ urgent threshold | 2 readings | projection safe for 10 min | Yes |
| No data | no reading for N min (20) | — | new reading | Never at night |
| Sensor ending | 24 h and 2 h before end | — | new sensor | Yes |
| Meal without insulin (optional) | meal logged, no insulin within W min | — | insulin logged / dismissed | Yes |

Profiles (Day / Night / School) change thresholds and recipients by schedule. Each alert message states the
fact, the trend, the time since the last meal/insulin, and links to the care plan. It never states a dose or a
number of grams to give.

---

## 7. Data model (Supabase, schema `carb`)

Existing: `members`, `settings`, `products`, `recipes`, `recipe_ingredients`, `recipe_versions`, `snacks`,
`meal_history`, `meal_plan`, `cgm_state`, `glucose_readings`.

New or changed:

```sql
-- readings: add where each came from
alter table carb.glucose_readings add column source text not null default 'librelinkup',
                                  add column is_history boolean not null default false;

-- sensor lifecycle
alter table carb.cgm_state add column sensor_serial text, add column sensor_activated_at timestamptz,
                           add column sensor_ends_at timestamptz;

-- one timeline for everything a person logs
create table carb.events (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid unique not null,              -- idempotency (double-tap safe)
  kind          text not null check (kind in ('insulin','carbs','meal','treatment','activity','note','fingerstick','sensor_change')),
  occurred_at   timestamptz not null,
  insulin_units numeric check (insulin_units > 0 and insulin_units < 100),
  insulin_type  text check (insulin_type in ('rapid','long','other')),
  carbs_g       numeric check (carbs_g >= 0),
  meal_id       uuid references carb.meal_history(id) on delete set null,
  activity_min  int, activity_level text check (activity_level in ('light','moderate','hard')),
  glucose_mgdl  int,                               -- fingerstick
  tag           text,                              -- sick, site_change, school_trip, …
  note          text,
  created_by    uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  edited_by uuid, edited_at timestamptz,
  deleted_by uuid, deleted_at timestamptz          -- soft delete
);

create table carb.care_plan (id boolean primary key default true, hypo text, hyper text, sick_day text,
                             contacts text, updated_by uuid, updated_at timestamptz);

create table carb.alert_rules (
  kind text, profile text check (profile in ('day','night','school')),
  threshold_mgdl int, rate_mgdl_min numeric, minutes int, enabled boolean,
  primary key (kind, profile));
create table carb.alert_profiles (profile text primary key, days int[], start_local time, end_local time);

create table carb.alerts (
  id uuid primary key default gen_random_uuid(), kind text, profile text,
  started_at timestamptz, value_mgdl int, state text check (state in ('active','acknowledged','resolved')),
  acknowledged_by uuid, acknowledged_at timestamptz, ack_action text,   -- on_it, treated, snooze
  snoozed_until timestamptz, escalation_level int default 0, resolved_at timestamptz);

alter table carb.members add column role text not null default 'parent'
  check (role in ('parent','caregiver','viewer','school')),
  add column escalation_order int, add column quiet_start time, add column quiet_end time;

create table carb.push_subscriptions (id uuid primary key, user_id uuid, endpoint text unique,
  p256dh text, auth text, device_label text, created_at timestamptz default now());
create table carb.notifications (id uuid primary key, alert_id uuid references carb.alerts,
  user_id uuid, channel text, sent_at timestamptz, delivered boolean, error text);

create table carb.daily_stats (day date primary key, coverage numeric, mean_mgdl numeric, sd_mgdl numeric,
  pct_very_low numeric, pct_low numeric, pct_in numeric, pct_high numeric, pct_very_high numeric,
  pct_in_target numeric, hypo_episodes int, hypo_minutes int, carbs_g numeric, insulin_entries int,
  computed_at timestamptz);

create table carb.insights (id uuid primary key, kind text, window_start timestamptz, window_end timestamptz,
  evidence jsonb, first_seen timestamptz, last_seen timestamptz, dismissed_by uuid, dismissed_at timestamptz);

create table carb.share_links (token_hash text primary key, scope text check (scope in ('school','viewer','clinic')),
  created_by uuid, expires_at timestamptz, revoked_at timestamptz);
```

**Relationships**

```
members ─┬─< events (created_by) >── meal_history >── recipes
         ├─< alerts (acknowledged_by) ──< notifications >── push_subscriptions
         └─< share_links
glucose_readings ──(time)── events, alerts, daily_stats, insights
alert_rules × alert_profiles ──▶ alert evaluator ──▶ alerts
```

All new tables: RLS on, members only; `school`/`viewer` roles read through views that expose only what
their scope allows. Service role (edge functions) writes readings, alerts, stats.

**Jobs (pg_cron)**
- every 1 min: `carb-glucose` poll (backfills the last 12 h each time, so gaps fill in if a poll is missed);
  then alert evaluation.
- 03:30 local: recompute `daily_stats` for yesterday and the last 14 days; run pattern rules.
- hourly: sensor lifecycle checks.

---

## 8. Must-have / Important / Advanced / Avoid

**Must-have (Phase 1)**
- Server-side polling every minute (history continues when the app is closed)
- Live reading with age, trend arrow, status sentence
- 3-hour graph on Home, 24-hour Timeline with event markers and visible gaps
- Insulin, carbs, treatment and note logging with who and when
- Duplicate guard, idempotency, soft delete with Undo
- Low, urgent low, high and no-data alerts (server evaluated, Web Push + in-app), "I'm on it" acknowledgement
- Care plan text linked from alerts
- Today's TIR line on Home

**Important (Phase 2)**
- Daily view with her typical band; weekly/14-day report; CSV export
- Rapid rise/fall alerts; alert profiles (Night, School) and per-person preferences; escalation
- Night mode and morning summary; School schedule and pickup summary
- Activity entries and note tags; sensor lifecycle
- Meal-response per recipe; time-of-day pattern rules
- Roles and read-only share links

**Advanced (Phase 3)**
- "Low soon" projection
- Unusual-day detection
- Monthly report and PDF for the clinic; AGP chart
- Phone-call escalation for urgent alerts at night
- Importing treatments from Gluroo's Nightscout endpoint (avoid double logging)
- School nurse quick-logging through a share link

**Avoid**
- Any dose calculator, dose suggestion, or advice to change a ratio or correction factor, or "give X g" advice
  (the Advanced tab *shows* prescribed and observed parameters side by side; it never proposes new ones)
- Presenting our alerts as the primary alarm, or letting anyone switch off urgent low / no data at night
- AI photo carb estimates feeding totals (contradicts the label-only rule)
- Interpolating across gaps, editing CGM values, hiding warm-up or old readings
- Estimated HbA1c without enough data, or shown as a lab value
- Gamification, scores or "bad day" language about a child
- A dense dashboard: one status sentence beats ten tiles
- Insulin-on-board on everyday screens or feeding any suggestion (it lives in Advanced only, section 10.9)

---

## 9. Development phases & acceptance criteria

### Phase 1 — Live and safe (≈ 3–4 weeks)
1. **Server polling** — pg_cron calls the poller every minute; Abbott is called at most once per 50 s.
   *Accept:* with every phone closed for 2 h, the Timeline afterwards shows continuous data with no gap longer
   than 20 min (unless the sensor itself had a gap).
2. **Home** — status sentence, number, arrow, age, 3-h graph, last meal, last insulin, Log button, alert strip,
   today's TIR.
   *Accept:* a parent can state glucose, direction, last meal and last insulin within 5 s (test with both
   parents); a reading 21 min old is never shown as the big number.
3. **Events** — insulin, carbs, treatment, note; who/when; edit, soft delete with Undo.
   *Accept:* double-tapping Save creates one entry; logging the same dose within 10 min shows who logged the
   first; deleted entries disappear from reports and can be restored by a parent.
4. **Alerts** — low, urgent low, high, no data; Web Push; in-app; acknowledgement; re-notify; resolve.
   *Accept:* simulated readings below the urgent threshold produce a push within 2 min; after one parent taps
   "I'm on it" the other sees their name and gets no repeat for the snooze time; urgent low cannot be disabled;
   no data for 20 min produces an alert.
5. **Care plan** — editable text, linked from every alert.
   *Accept:* every alert screen shows the plan; no screen anywhere shows a dose suggestion.

### Phase 2 — Understand the day (≈ 4–6 weeks)
6. **Daily view & 14-day report.** *Accept:* TIR percentages match a hand calculation on a fixture day to
   within 0.5 percentage points; days with < 70% coverage say "not enough data".
7. **Rapid rise/fall, profiles, escalation.** *Accept:* night profile switches on at the scheduled time;
   unacknowledged low escalates to the second caregiver after the set minutes.
8. **Night mode & School mode.** *Accept:* night view readable at arm's length (number ≥ 96 px); school
   pickup summary lists lowest, highest, entries and TIR for the school window.
9. **Meal response & patterns.** *Accept:* a recipe shows a response only with ≥ 3 valid meals; each insight
   names its evidence and can be dismissed.
10. **Roles & share links.** *Accept:* a school link shows only number, arrow, age and care plan, expires on
    time, and stops working immediately when revoked.

### Phase 3 — Advanced (as needed)
11. Low-soon projection (behind a setting, after Phase 2 data quality is proven). 12. Unusual-day detection.
13. Monthly/PDF/AGP reports. 14. Phone-call escalation. 15. Gluroo/Nightscout treatment import with
duplicate matching. *Accept for each:* documented rule, fixture-based tests, and a visible "how this is
calculated" note in the app.

---

---

## 10. Advanced (متقدم) — the engineering dashboard

The Advanced tab treats glucose control like a process: state, variability, excursions, insulin response,
meal response, correlations and derived parameters. Everyday screens stay simple; this tab carries the depth.

### 10.1 Two layers that are never mixed

Every number carries one badge:

| Badge | Meaning | Examples |
|---|---|---|
| **Published** | Formula from a standard or guideline, the same for every person | TIR/TBR/TAR, mean, SD, CV, GMI, MAGE, MODD, CONGA, LBGI/HBGI, ADRR, ISF estimate 1800/TDD |
| **Layan-derived** | Measured from her own data, with n and confidence | Observed ICR and ISF, meal response, time-of-day factors, correlations |
| **Prescribed** | Entered by a parent from her care team | ICR and ISF by time of day, targets, insulin action time |

Published and Layan-derived values are never averaged together or shown as one number.

### 10.2 Safety boundary (applies to every item below)

- Prescribed values are entered by a parent; the app never edits them.
- Observed values are shown *next to* prescribed ones, labelled "observed — for discussion with her care
  team". The app never says increase, reduce, change, or use.
- Below the minimum sample size (10.11) a derived value is hidden, not shown faintly.
- Correlation is reported as association ("meals with > 20 g fat were associated with larger 3–5 h rises in
  14 comparable meals"), never as cause.
- IOB is display-only and never feeds a suggestion.
- A wording test in CI fails the build if any Advanced string contains a dose instruction
  (e.g. "increase", "decrease", "give", "زِد", "قلّل", "أعطِ" followed by a dose).

### 10.3 Top screen

Period selector: **Today · 3 d · 7 d · 14 d · 30 d · 90 d**. Six groups, two to four numbers each, every number
with its badge and a confidence dot. Tap any number → detail page with chart, formula ("How this is
calculated"), n, confidence and the events behind it.

```
CONTROL     TIR · TBR · TAR · Mean · GMI · CV
INSULIN     TDD · Basal/Bolus · ICR (prescribed | observed) · ISF (prescribed | observed) · IOB
RESPONSE    Meal ΔG · Peak · iAUC · Recovery
STABILITY   SD · CV · MODD · MAGE
RISK        Hypo events · Hyper events · LBGI · HBGI
ANALYSIS    Meals · Insulin · Exercise · Time of day · Correlations · Factors
```

### 10.4 Glycemic state (Published)

| KPI | Calculation | Min data | Phase |
|---|---|---|---|
| Current glucose, Δ, rate of change | as 5.1–5.2; RoC = least-squares slope over 15 min | 3 points, no gap | 1 |
| Mean, median, min, max | time-weighted mean (5.4); median and extremes of readings | coverage ≥ 70% | 2 |
| SD | time-weighted standard deviation | coverage ≥ 70% | 2 |
| CV | SD / mean × 100 (consensus ≤ 36%) | coverage ≥ 70% | 2 |
| GMI | 3.31 + 0.02392 × mean (mg/dL), labelled "GMI, not HbA1c" | ≥ 14 days, ≥ 70% | 2 |
| Data availability | covered time / period length | — | 1 |

### 10.5 Time in Range performance (Published)

Bands in mmol/L: TBR level 2 < 3.0 · TBR level 1+2 < 3.9 · TIR 3.9–10.0 · TAR level 1+2 > 10.0 · TAR level 2 > 13.9.
Reference targets shown as faint markers (TIR > 70%, < 3.9 under 4%, < 3.0 under 1%, > 10.0 under 25%,
> 13.9 under 5%) with the note "her care team's targets come first"; her own targets, if entered, replace them.

Each percentage is also shown as time per day: `hours = pct × 24` → **82% = 19 h 41 min/day**.
Phase 2.

### 10.6 Insulin engineering

| KPI | Calculation | Layer | Min data | Phase |
|---|---|---|---|---|
| TDD | Σ basal + Σ bolus per local day | Published | day marked "insulin log complete" | 3 |
| Basal %, Bolus % | basal / TDD × 100; bolus / TDD × 100 | Published | complete days | 3 |
| Meal, correction, basal insulin | Σ by bolus purpose | — | purpose recorded | 3 |
| U/kg/day | TDD / weight | Published | weight within 90 days | 3 |
| 7-day and 14-day TDD, trend | mean of complete days; slope of daily TDD | Published | ≥ 5 / 10 complete days | 3 |
| ICR prescribed | parent-entered per time block | Prescribed | — | 3 |
| ICR used (observed) | median of carbs / meal bolus for clean meals, per time block | Layan-derived | n ≥ 10 | 3 |
| ICR matched-outcome | median ratio among clean meals whose 3 h glucose ended within ±1.7 mmol/L of G₀ with no hypo | Layan-derived | n ≥ 10 | 3 |
| ISF published estimate | 1800 / TDD (mg/dL/U) ≈ 100 / TDD (mmol/L/U), labelled "published starting estimate" | Published | 7-day TDD | 3 |
| ISF prescribed | parent-entered per time block | Prescribed | — | 3 |
| ISF observed | 10.8 | Layan-derived | n ≥ 10 | 3 |

The detail page shows **prescribed | observed | published estimate** side by side with n and confidence.

### 10.7 Meal response (Layan-derived)

For every meal with carbs logged:

| Value | Definition |
|---|---|
| G₀ | glucose within ±10 min of meal time |
| CHO, fat, protein, fiber | from the meal entry (label data, already in this app) |
| Insulin, ratio used | meal bolus linked to the meal; CHO / U |
| Pre-bolus time | meal time − bolus time (positive = before eating) |
| G(t) | at +30, +60, +90, +120, +180, +240 min (nearest reading within ±5 min; never across a gap) |
| ΔG(t) | G(t) − G₀ |
| Peak excursion, time to peak | max G − G₀ in 0–4 h; its time |
| iAUC | incremental area above G₀, trapezoid rule, positive parts only, 0–4 h (mmol·h/L) |
| Recovery time | from peak until glucose stays within her target range (or within ±1.0 of G₀) for 15 min |
| Undershoot | min G in 0–4 h − G₀ |

**Clean meal:** no other carbs and no correction bolus in 0–4 h, no hypo treatment, no exercise, CGM coverage ≥ 90%
in the window. Comparisons (rice vs pasta vs cereal, recipe vs recipe) use clean meals only, show n, and
overlay the median curve with its 25–75% band. Phase 2 (G(t), ΔG, peak, TTP, iAUC, recovery, undershoot),
Phase 3 (pre-bolus and insulin linkage).

### 10.8 Correction analysis (Layan-derived)

Observed ISF = (G_start − G_end) / correction units, with G_end = glucose 3 h after the bolus (configurable
2–4 h; rapid-acting insulin).
**Clean correction:** bolus purpose = correction; no carbs from 3 h before to 4 h after; no other bolus in
the 4 h before (IOB from earlier doses below 0.2 U) or during; no exercise; no hypo treatment; CGM coverage
≥ 90%. Distribution per time block — night 00–06, morning 06–11, afternoon 11–17, evening 17–24 (editable) —
with median, interquartile range and n. Phase 3.

### 10.9 Insulin on board (display only)

`IOB(t) = Σ doseᵢ × remaining(t − tᵢ)`, using the exponential insulin-activity curve (as in open-source
Loop/OpenAPS) with **duration of action and peak time entered from the care team**. The model and its two
parameters are printed under every IOB value.
Also shown: time since last bolus, bolus overlap (a bolus while IOB > 0), and a *stacking* flag (two or more
boluses within the action time). Flags are information only: "2 boluses within 3 h". Phase 3, after the care
team has seen and agreed the model parameters.

### 10.10 Variability & risk (Published, marked "Analytical")

| KPI | Calculation | Min data |
|---|---|---|
| MAGE | mean amplitude of peak-to-nadir excursions larger than 1 SD (Service 1970); implementation documented, results checked against the `iglu` reference package | 7 days |
| MODD | mean of \|G(t) − G(t − 24 h)\| over paired readings (±5 min) | 2 days, paired coverage ≥ 70% |
| CONGA-n (n = 1, 2, 4 h) | SD of D(t) = G(t) − G(t − n h) | 1 day |
| LBGI / HBGI | f = 1.509 × ((ln G)^1.084 − 5.381) with G in mg/dL; r = 10 f²; LBGI = mean of r where f < 0, HBGI = mean of r where f > 0 | 1 day |
| ADRR | mean over days of (max daily low-risk r + max daily high-risk r) | 14 days |

These carry the badge "Analytical — not a clinical target" and live behind an expandable section. Phase 3.

### 10.11 Event engine (feeds everything above)

Detected automatically and stored as rows, so every metric can show the events behind it:

| Event | Attributes |
|---|---|
| Hypo | start, lowest value, duration, treatment carbs, recovery time, rebound peak (max within 2 h after) |
| Hyper | start, peak, duration, correction given, response (fall in 3 h) |
| Meal | 10.7 |
| Correction | starting glucose, units, IOB at the time, fall, observed ISF, clean yes/no and why not |
| Exercise | glucose before, trend, IOB, carbs, minimum during, after, overnight minimum the following night |

Phase 2 (hypo, hyper, meal), Phase 3 (correction, exercise).

### 10.12 Correlations & factors (Layan-derived)

Relationships analysed (each a scatter plot with n, Pearson r, Spearman ρ, R², direction and confidence):
carbs ↔ peak and iAUC · insulin ↔ fall · pre-bolus time ↔ peak · G₀ ↔ excursion · fat ↔ 3–5 h rise ·
protein ↔ late rise · fiber ↔ peak · exercise ↔ slope and overnight minimum · night ↔ variability ·
time of day ↔ observed ISF and ICR · meal type ↔ excursion · day of week ↔ TIR · insulin ↔ hypo within 4 h.

Shown only when n ≥ 10 comparable events. Confidence: **High** n ≥ 30 and |r| CI excludes 0 ·
**Medium** n ≥ 15 · **Low** n 10–14. Sentence template: "*X* was associated with *Y* in *n* comparable *events*".

**Factors** = observed value in a condition ÷ her baseline observed value, e.g. evening ISF 3.2 ÷ baseline 4.0
= 0.80 → "observed evening sensitivity ≈ 20% lower (n = 12, medium)". Conditions: time of day, exercise day,
meal composition (high fat / protein / fiber), pre-bolus band (0–5, 5–10, 10–15, 15–20, > 20 min), starting
glucose band, trend arrow, hypo in the last 24 h, illness, ketones. Phase 3.

### 10.13 Data quality on every number

| Confidence | Event-based metrics | CGM-period metrics |
|---|---|---|
| High | n ≥ 30 | ≥ 14 days and ≥ 90% coverage |
| Medium | n 15–29 | ≥ 14 days and ≥ 70% |
| Low | n 10–14 | 7–13 days or 50–69% |
| Hidden | n < 10 (meal response per recipe: n < 3) | < 50% coverage |

Shown as a dot plus "n = 24" under every value.

### 10.14 Extra data this needs

```sql
alter table carb.events add column bolus_purpose text check (bolus_purpose in ('meal','correction','both')),
                       add column linked_meal_event uuid references carb.events(id),
                       add column ketones_mmol numeric;            -- kind = 'ketones'
-- kind gains: 'basal', 'ketones', 'illness'

create table carb.child_profile (id boolean primary key default true, weight_kg numeric, weight_at date,
  insulin_rapid text, insulin_basal text, updated_by uuid, updated_at timestamptz);

create table carb.prescribed_params (            -- entered by a parent from the care team, versioned
  id uuid primary key default gen_random_uuid(), block text check (block in ('night','morning','afternoon','evening')),
  icr_g_per_u numeric, isf_mmol_per_u numeric, target_mmol numeric,
  dia_hours numeric, peak_minutes int, effective_from date not null, entered_by uuid, entered_at timestamptz default now());

create table carb.insulin_days (day date primary key, complete boolean, confirmed_by uuid);   -- "today's insulin log is complete"

create table carb.analytics_events (              -- output of the event engine
  id uuid primary key default gen_random_uuid(), kind text, start_at timestamptz, end_at timestamptz,
  source_event uuid references carb.events(id), metrics jsonb, clean boolean, not_clean_reason text,
  computed_at timestamptz default now());

create table carb.analytics_cache (period text, metric text, value numeric, n int, confidence text,
  inputs jsonb, computed_at timestamptz, primary key (period, metric));
```

Logging changes: the insulin entry gains *purpose* (meal / correction / both) and *basal*; a meal bolus links
to its meal; a "today's insulin is complete" tick at bedtime makes TDD trustworthy.

### 10.15 Acceptance criteria (Advanced)

1. **Formulas** — every Published metric has a unit test on a fixture data set whose expected values come from
   the `iglu` R package (MAGE, MODD, CONGA, LBGI, HBGI, ADRR, CV, GMI) to within 1%.
2. **Layers** — every value on screen carries exactly one badge; no screen combines Published and
   Layan-derived values into one number.
3. **Gating** — with 9 clean corrections no observed ISF is shown; with 10 it appears with "Low" confidence.
4. **Clean windows** — a correction followed by a snack 2 h later is excluded and the detail page says why.
5. **Wording** — the CI wording test passes; no Advanced string tells anyone to change a dose.
6. **IOB** — the model name and parameters are printed under every IOB value; IOB is absent from Home and
   from every alert.
7. **Speed** — the top screen loads in under 1 s from cache; heavy analysis is computed nightly and on demand,
   never on the phone at open.

### 10.16 Phasing summary

| Phase | Advanced content |
|---|---|
| 2 | Control and TIR (incl. hours/day), median, data-quality dots, meal response (G(t), ΔG, peak, iAUC, recovery, undershoot), hypo/hyper/meal events, per-recipe comparison |
| 3 | Insulin engineering, prescribed vs observed ICR/ISF, correction analysis, IOB (after care-team agreement), MAGE/MODD/CONGA/LBGI/HBGI/ADRR, correlations, factors, correction and exercise events |

---

## 11. Analysis (التحليل) — the CGM timeline engine

A dedicated glucose-investigation experience. It answers three questions, in this order, and shows
complexity only when asked: **What is happening now? What caused it? Does this keep happening?**
It borrows real-time awareness from Gluroo, the glucose–insulin–carbs relationship from Tidepool, Overlay /
Compare / Patterns from Dexcom Clarity, and the AGP statistical view — simplified for a phone. Every rule in
the ground rules and in 10.2 applies here unchanged.

### 11.1 Decisions where this chapter adapts the original brief

| Brief | Decision | Why |
|---|---|---|
| New main tab "التحليل" | The **متقدم** tab becomes **التحليل**; still 5 tabs | A sixth tab breaks Hick/Miller (DESIGN_SYSTEM 12b); Advanced content moves inside it |
| Live mode | Tapping the graph on الآن opens Analysis → Live at "now" | الآن stays the 5-second screen; Live is its full-depth version |
| Haptics when scrubbing | Android: short vibration. **iPhone: not available to web apps** (Safari has no vibration API) — the marker snaps, enlarges and the inspector updates instead | Honest platform limit |
| COB | Same rule as IOB (10.9): off by default, model and parameters printed under every value, Phase 3 after the care team agrees the absorption time | COB is a model, not a measurement |
| Basal layer | Long-acting injections shown as markers (no basal rate unless a pump is used later) | Matches what is logged today |
| Exercise, Sleep | New event kinds: exercise (minutes, light/moderate/hard), sleep (start/end) | Not logged yet |
| Emoji markers | Layan SVG icons (DESIGN_SYSTEM 6) | One icon system |
| mmol/L in examples | Shown in the parents' chosen unit (mg/dL or mmol/L) | Existing setting |
| "The CGM app is responsible for alerts" | Kept: our alerts are a second line (ground rule 3) | Already the rule |

### 11.2 Navigation

Inside التحليل, a segmented control: **Live · Day · Patterns · Meals · Compare**. One job per mode — never
all functions on one screen. The current Advanced KPI and engineering content (section 10) lives under
Day → "More metrics" and in each mode's "How this is calculated" sheet.

Information priority on every mode (visual weight in this order): 1 current glucose · 2 direction · 3 curve ·
4 target range · 5 meals/insulin · 6 IOB/COB · 7 analysis · 8 statistics.

### 11.3 Live

- Header, no card around it: big number + trend icon + unit; under it `Δ15 min · rate per min`; then
  "updated 2 min ago" (freshness rules 5.1). Low/high shows as a compact status line above the graph
  ("3.2 ↓ — منخفض"), never a banner that covers the chart.
- Graph takes **45–55 % of the screen height**, default 3 h, "Now" button returns to live with a short pan
  animation; a new reading slides in (no pulsing, no bouncing numbers).
- Event rail and layers as 11.5.

### 11.4 Glucose trace, target band, data quality

- **Target band**: the parents' range as a subtle filled horizontal region (not just lines). With no range
  set: no band, a one-line prompt to set it.
- **State colour per segment**: very low / low / in range / high / very high, using the restrained medical
  tokens; the line is neutral in range and coloured only outside it. Colour is never the only signal: the
  band position, the y-axis labels and the inspector text carry the same state.
- **Raw points** (dots) appear at ≤ 3 h zoom; wider zooms draw a line. Readings since server polling began
  are 1-minute; older backfill is 15-minute — the dot density shows this honestly.
- **Gaps**: any interval > 20 min is a visible break with a label ("27 min missing"); never joined, never
  interpolated. The last reading's state is shown as **Live** (≤ 5 min), **Delayed** (5–15 min) or
  **Missing** (> 15 min).
- **Smoothing / downsampling is display-only**: per pixel column draw the min and max of the readings in it
  (min–max decimation), so a real low can never disappear and no peak can be invented. Zooming in or
  inspecting always shows the stored readings.

### 11.5 Event rail, grouping, layers, secondary tracks

- **Event rail** under the trace, on the same time axis: meal (carbs g), insulin (U, rapid/long), hypo
  treatment (g), exercise (min), note. Compact markers by default — not four permanent rows.
- **Grouping**: events within 20 min (at the current zoom, within 24 px) merge into one chip, e.g.
  "Meal · 45 g + 3 U"; tap to expand.
- **Layers** button beside the period selector. Default on: Glucose, Meals, Insulin, Hypo treatments.
  Default off: IOB, COB, Basal (long-acting), Exercise, Notes, Sleep. Choice remembered per device.
- **IOB / COB** never share the glucose y-axis: each is a thin synchronized track under the rail with its own
  scale and its model line ("model: exponential, DIA 4 h, peak 75 min — from care team").

### 11.6 Zoom behaviour (one engine, different renderers)

| Window | Renderer | Shows |
|---|---|---|
| 3 h | Detail | dots, line, all events with labels, inspector values |
| 6–12 h | Line | line, major events, grouped chips |
| 24 h | Day | line, icons without labels, day-part shading (Night 00–06 · Morning 06–12 · Afternoon 12–18 · Evening 18–24) |
| 3–14 d | Daily strips | one compact row per day (colour by state per 15 min) + daily TIR |
| 30–90 d | AGP | median, 25–75 %, 10–90 % over a standard 24 h |

Period selector: **3H 6H 12H 24H 7D 14D 30D 90D**; on narrow phones the last ones go under "More".

### 11.7 Gestures, crosshair, inspectors

| Gesture | Action |
|---|---|
| Swipe horizontally | travel in time |
| Pinch | zoom (snaps to the nearest period above after release) |
| Double tap | zoom in around that point |
| Tap reading / event | reading inspector / event inspector |
| Long press | crosshair; drag to scrub |
| "Now" | back to live |

No +/− buttons. Touch targets ≥ 44 px; the crosshair hit area is the whole graph height.

**Crosshair inspector** (floating, follows the finger): time · glucose · Δ15 min · rate · and — only when that
layer is on — IOB and COB. Crossing a meal, insulin or low snaps and (Android) vibrates.

**Event inspector** (bottom sheet, never navigates away), e.g. a meal: name, time, carbs, linked bolus,
pre-bolus minutes, starting glucose, IOB (if on); glucose response at +30/60/90/120/180 min, peak, rise,
time to peak (definitions 10.7; values only where there is no gap); "Full meal analysis →" opens Meals mode
on that recipe.

### 11.8 Day

- Title "Today · Thursday 1 Oct"; swipe or date picker for other days.
- One row of four KPIs: **Avg · TIR · Low · High**. "More metrics": SD, CV, GMI (14 d only), min, max,
  coverage, total carbs, total insulin.
- 24 h chart (one continuous timeline with subtle day-part shading).
- **Today's events** list below. Tap a row → the graph centres on that moment; tap a graph event → the
  event inspector. Two-way navigation is required.

### 11.9 Patterns & AGP

- 24-hour clock (00–24), all selected days overlaid as statistics: **median line, 25–75 % dark band,
  10–90 % light band**, target band behind. Bins of 15 min; each bin needs ≥ 5 days of data or it is drawn
  hollow ("not enough data").
- Filters: **All · School days · Weekend · Custom** and weekday chips (Sun–Sat; Kuwait week). School days
  come from the School schedule (3.14).
- 14 / 30 / 90 d is the AGP view, with the published AGP KPIs alongside.
- **Observed pattern cards** (rules from 5.7, descriptive only): "Overnight decline · 5 of 7 nights ·
  00:30–04:00". Tap → highlight the contributing nights on the chart. Cards show n and can be dismissed;
  they never suggest a change.

### 11.10 Meals (signature feature)

- Search a recipe → "Eaten 8 times". All occurrences aligned at **T0 = meal time**, window −60 to +240 min,
  thin lines per meal, median line and 25–75 % band on top.
- Summary (medians): occurrences, typical carbs, typical insulin, starting glucose, peak, excursion, time to
  peak, glucose at 3 h. Rules and "clean meal" definition: 10.7. Minimum 3 clean meals.
- Later: filter by pre-bolus band (< 5 min vs 10–20 min) and overlay the two medians — labelled
  "historical observation", never advice.

### 11.11 Compare

- Presets: **Today vs Yesterday · This week vs Last week · School vs Weekend · Custom A vs B**.
- Two stacked charts with the same x and y axes; pan/zoom on one moves the other. Not overlaid by default.
- Table of A vs B (TIR, CV, low, mean, coverage) — differences only, no "better/worse", no winner.

### 11.12 Landscape, RTL, accessibility, motion

- Rotating to landscape on any graph enters **full-screen analysis**: date, period, Layers, the chart, the
  rail and the period selector — nothing else.
- RTL: page chrome is right-to-left; **the time axis always runs left → right**; numbers and units are
  isolated (`6.2 mmol/L` never reorders).
- Accessibility: state by position + label + icon, not colour alone; works at 200 % text size (chart keeps its
  height, labels wrap below); every chart has a text summary for screen readers.
- Motion only for data changes: new reading, back to Now, zoom, opening an event, changing date or layers.
  `prefers-reduced-motion` turns them into instant changes.

### 11.13 Performance & architecture

Performance is part of the UX:
- Pan and zoom at 60 fps on a mid-range phone with 90 days loaded; Analysis opens in < 1 s from cache.
- Rendering on **Canvas 2D** (not SVG) from typed arrays; min–max decimation per pixel; raw readings kept
  underneath.
- Readings fetched in day chunks and cached (IndexedDB) so a scroll never waits on the network.
- Percentile profiles, daily strips and meal responses computed **in the database** (SQL functions, cached
  per day) or in a Web Worker — never in the render loop.

Structure (a reusable engine, not one component):

```
CGM Timeline Engine
├── Scale & viewport (time ↔ x, glucose ↔ y, zoom level → renderer)
├── Layers: glucose · target · events (meal, insulin, treatment, exercise, note, sleep) · derived (IOB, COB, rate)
├── Interaction: pan · pinch · double-tap · crosshair · selection · haptics (where available)
└── Analysis: day stats · patterns/AGP · meal response · compare
```

### 11.14 Build order & acceptance criteria

| Stage | Content | Accept |
|---|---|---|
| A1 | Engine: canvas trace, target band, gaps, freshness state, pan, pinch, Now, crosshair | 60 fps pan on fixture of 90 days; a 27-min gap is drawn and labelled; a single 2.9 mmol/L reading inside 90 days is visible at every zoom |
| A2 | Event rail, grouping, inspectors, Layers | every event sits at its exact minute; grouped chips expand; inspector values match 10.7 on a fixture meal |
| A3 | Day mode + two-way list ↔ graph | KPIs match `glucose_stats` to 0.5 pp; tapping a row centres the graph within 300 ms |
| A4 | IOB / COB tracks | only after the care team agrees the parameters; model line under every value |
| A5 | Patterns / AGP + filters | percentiles match a hand calculation on a fixture; bins with < 5 days drawn hollow |
| A6 | Meals response | ≥ 3 clean meals required; median curve and summary match a fixture |
| A7 | Compare | both charts scroll together; table shows differences only |
| A8 | Observed pattern cards | each card names its rule and n, drills down to its nights, can be dismissed |

A1–A2 deliver the must-have 24-hour Timeline (section 8) right after Phase 1 alerts and care plan; A3 is
Phase 2 step 6 (Daily view); A5–A6 are part of Phase 2 step 9; A4, A7, A8 are Phase 3.

---

## 12. Implementation stages (remaining work = 100 %)

| # | Stage | Share | Contents |
|---|---|---|---|
| 1 | Alerts & care plan | 14 % | Low, urgent low, high, no data; Web Push; "I'm on it"; repeat; care plan (9 / Phase 1 steps 4–5) |
| 2 | Timeline engine | 16 % | 11.14 A1: canvas trace, target band, gaps, pan/pinch, crosshair, Now |
| 3 | Event rail | 10 % | A2: markers, grouping, inspectors, Layers; exercise and sleep logging |
| 4 | Day view | 8 % | A3: KPIs, More metrics, list ↔ graph |
| 5 | Profiles & modes | 10 % | Night / School profiles, escalation to the other parent, rapid rise/fall, Night and School screens |
| 6 | Patterns & AGP | 10 % | A5: percentiles, School/Weekend filters |
| 7 | Meal response | 10 % | A6: recipe curves at T0, medians, clean meals |
| 8 | Compare & landscape | 7 % | A7 and full-screen landscape |
| 9 | Sharing & reports | 7 % | Roles, share links, CSV/PDF |
| 10 | IOB / COB | 5 % | A4, only after the care team agrees the parameters |
| 11 | Pattern cards & variability | 3 % | A8, section 10.10–10.12 |

Each stage ships as its own app version and is accepted against the criteria in sections 9 and 11.14.

**Progress:** stage 1 shipped in 0.7.0; stage 2 in 0.8.0 (measured: a 90-day frame draws in 0.6 ms median,
1.3 ms worst, on the test browser; a single 2.9 mmol/L reading survives at every zoom and pan position; a
27-minute gap is drawn and labelled). Completed: 30 %. Interim in stage 2: beyond 3 days the trace is drawn as
a light min–max range band until the daily-strip (stage 4) and AGP (stage 6) renderers replace it; pinch
snaps to the nearest standard period on release.


## Sources

- Gluroo: [The Collaborative Diabetes Management App](https://gluroo.com/home-old/),
  [The Diabetes App Parents Are Raving About](https://gluroo.com/blog/glucrew/diabetes-app-parents-are-raving-about/),
  [Dec 2024 release: charts, heads-up display, daily view](https://gluroo.com/blog/releases/gluroo-dec-2024-feature-release-better-charts-heads-up-display-daily-view-and-health-care-provider-support/),
  [User manual](https://gluroo.com/user-manual/), [Smartwatch / Nightscout](https://gluroo.com/blog/glucrew/blood-sugar-readings-smartwatch-gluroo/)
- Dexcom: [Urgent Low Soon](https://www.dexcom.com/en-us/faqs/how-does-the-urgent-low-soon-alert-work),
  [G7 alert changes](https://www.dexcom.com/en-us/faqs/are-there-any-changes-to-alerts-for-dexcom-g7-compared-to-dexcom-g6),
  [Dexcom Follow](https://www.dexcom.com/en-us/dexcom-follow)
- Abbott Libre: [Optional alarms](https://www.freestyle.abbott/uk-en/products/freestyle-libre-2/freestyle-libre2-alarms.html),
  [LibreLinkUp FAQ](https://www.librelinkup.com/faqs)
- mySugr: [Logbook user manual](https://assets.mysugr.com/app_logbook/ios/3.122.0/manual/eu/en/user_manual_tab_bar.pdf)
- Nightscout: [cgm-remote-monitor](https://github.com/nightscout/cgm-remote-monitor),
  [configuration](https://nightscout.github.io/nightscout/setup_variables/)
- Variability and risk metrics: [iglu R package documentation](https://irinagain.github.io/iglu/)
- Sugarmate phone-call alerts: [overview](https://healthcare.toolsinfo.com/tool/sugarmate),
  [ADCES alarm-fatigue hacks](https://www.adces.org/education/danatech/glucose-monitoring/continuous-glucose-monitors-(cgm)/cgm-101/10-smart-hacks-for-alarm-fatigue-heavy-sleepers-and-people-with-disabilities)
- Consensus metrics: [International Consensus on Use of CGM](https://pmc.ncbi.nlm.nih.gov/articles/PMC6467165/),
  [ADCES glycemic metrics](https://www.adces.org/education/danatech/glucose-monitoring/continuous-glucose-monitors-(cgm)/glycemic-metrics--an-overview),
  [AGP report explainer](https://www.timeinrange.org/wp-content/uploads/2025/06/What-is-the-AGP-report-1.pdf)
- Web Push on iPhone: [PWA iOS limitations](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
