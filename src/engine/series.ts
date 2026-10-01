// CGM Timeline Engine — data layer (GLUCOSE_PLAN 11.4, 11.13). Pure: no DOM, no React, tested in Node.
// Readings live in typed arrays; everything here works on index ranges so a frame never allocates per reading.

export const GAP_MS = 20 * 60000; // a longer interval between readings is a gap: drawn as a break, never joined
const MIN = 60000;

export interface Series { t: Float64Array; v: Float64Array } // epoch ms ascending, mg/dL

export const emptySeries = (): Series => ({ t: new Float64Array(0), v: new Float64Array(0) });

/** Merge new readings in, keeping time order and one value per timestamp (the new value wins). Linear time. */
export function mergeSeries(a: Series, times: ArrayLike<number>, values: ArrayLike<number>): Series {
  const m = times.length;
  if (!m) return a;
  let bt = Float64Array.from(times), bv = Float64Array.from(values);
  for (let i = 1; i < m; i++) if (bt[i] < bt[i - 1]) { // rarely needed: sort the incoming batch
    const idx = Array.from(bt.keys()).sort((x, y) => bt[x] - bt[y]);
    bt = Float64Array.from(idx, (k) => times[k]); bv = Float64Array.from(idx, (k) => values[k]); break;
  }
  const n = a.t.length, t = new Float64Array(n + m), v = new Float64Array(n + m);
  let i = 0, j = 0, k = 0;
  while (i < n || j < m) {
    if (j >= m || (i < n && a.t[i] < bt[j])) { t[k] = a.t[i]; v[k++] = a.v[i++]; }
    else {
      if (i < n && a.t[i] === bt[j]) i++;                     // same instant: keep the new value
      if (k && t[k - 1] === bt[j]) { v[k - 1] = bv[j++]; continue; } // duplicate inside the batch
      t[k] = bt[j]; v[k++] = bv[j++];
    }
  }
  return { t: t.subarray(0, k), v: v.subarray(0, k) };
}

/** First index with t[i] >= x. */
export function lowerBound(t: Float64Array, x: number) {
  let lo = 0, hi = t.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

export interface Gap { from: number; to: number; minutes: number; open: boolean } // open = still missing now

/** Gaps overlapping [start, end]; the interval after the last reading counts as an open gap once it passes GAP_MS. */
export function gapsIn(s: Series, start: number, end: number, now: number): Gap[] {
  const out: Gap[] = [];
  const i0 = Math.max(0, lowerBound(s.t, start) - 1), i1 = Math.min(s.t.length - 1, lowerBound(s.t, end));
  for (let i = i0; i < i1; i++) {
    const d = s.t[i + 1] - s.t[i];
    if (d > GAP_MS && s.t[i + 1] >= start && s.t[i] <= end) out.push({ from: s.t[i], to: s.t[i + 1], minutes: Math.round(d / MIN), open: false });
  }
  const last = s.t.length ? s.t[s.t.length - 1] : -Infinity;
  if (s.t.length && now - last > GAP_MS && now >= start && last <= end) out.push({ from: last, to: now, minutes: Math.round((now - last) / MIN), open: true });
  return out;
}

/**
 * Drawable runs for a viewport: readings split at gaps, then reduced to at most two points per pixel column
 * (the column's min and max, in time order). Min–max decimation keeps every real low and high at every zoom
 * and never invents a value. Output is in pixel x and raw mg/dL.
 */
export interface Run { x: number[]; v: number[]; raw: boolean }
export function runsFor(s: Series, start: number, end: number, width: number): Run[] {
  const runs: Run[] = [];
  if (!s.t.length || width <= 0 || end <= start) return runs;
  const i0 = Math.max(0, lowerBound(s.t, start) - 1), i1 = Math.min(s.t.length, lowerBound(s.t, end) + 1);
  const pxPerMs = width / (end - start);
  const raw = i1 - i0 <= width; // few enough to draw every reading as is
  let run: Run | null = null;
  let col = NaN, cMin = 0, cMax = 0, tMin = 0, tMax = 0;
  const flush = () => {
    if (!run || Number.isNaN(col)) return;
    const xa = (Math.min(tMin, tMax) - start) * pxPerMs, xb = (Math.max(tMin, tMax) - start) * pxPerMs;
    const [va, vb] = tMin <= tMax ? [cMin, cMax] : [cMax, cMin];
    run.x.push(xa); run.v.push(va);
    if (cMin !== cMax) { run.x.push(xb); run.v.push(vb); }
    col = NaN;
  };
  for (let i = i0; i < i1; i++) {
    const t = s.t[i], v = s.v[i];
    if (!run || (i > i0 && t - s.t[i - 1] > GAP_MS)) {
      flush();
      run = { x: [], v: [], raw };
      runs.push(run);
    }
    const x = (t - start) * pxPerMs;
    if (raw) { run.x.push(x); run.v.push(v); continue; }
    const c = Math.floor(x);
    if (c !== col) { flush(); col = c; cMin = cMax = v; tMin = tMax = t; }
    else { if (v < cMin) { cMin = v; tMin = t; } if (v > cMax) { cMax = v; tMax = t; } }
  }
  flush();
  return runs;
}

/** Nearest reading to t within `tol` ms, never reaching across a gap. */
export function nearest(s: Series, t: number, tol = 5 * MIN): number | null {
  if (!s.t.length) return null;
  const i = lowerBound(s.t, t);
  let best = -1;
  if (i < s.t.length) best = i;
  if (i > 0 && (best < 0 || t - s.t[i - 1] <= s.t[best] - t)) best = i - 1;
  return best >= 0 && Math.abs(s.t[best] - t) <= tol ? best : null;
}

/** Change over the 15 minutes before t (reading at t vs reading ~15 min earlier), or null if either is missing. */
export function delta15(s: Series, i: number): number | null {
  const j = nearest(s, s.t[i] - 15 * MIN, 4 * MIN);
  if (j === null || s.t[i] - s.t[j] < 10 * MIN) return null;
  for (let k = j; k < i; k++) if (s.t[k + 1] - s.t[k] > GAP_MS) return null;
  return s.v[i] - s.v[j];
}

/** Rate of change at reading i: least-squares slope over the previous 15 minutes (mg/dL per minute). ≥ 3 points, no gap. */
export function rateAt(s: Series, i: number): number | null {
  const from = s.t[i] - 15 * MIN;
  let j = i;
  while (j > 0 && s.t[j - 1] >= from) { if (s.t[j] - s.t[j - 1] > GAP_MS) break; j--; }
  const n = i - j + 1;
  if (n < 3 || s.t[i] - s.t[j] < 5 * MIN) return null;
  let mt = 0, mv = 0;
  for (let k = j; k <= i; k++) { mt += s.t[k]; mv += s.v[k]; }
  mt /= n; mv /= n;
  let num = 0, den = 0;
  for (let k = j; k <= i; k++) { const dt = (s.t[k] - mt) / MIN; num += dt * (s.v[k] - mv); den += dt * dt; }
  return den ? num / den : null;
}

/** Live (≤ 5 min), delayed (≤ 15 min) or missing — shown next to the number. */
export function freshness(lastT: number | null, now: number): 'live' | 'delayed' | 'missing' {
  if (lastT === null) return 'missing';
  const m = (now - lastT) / MIN;
  return m <= 5 ? 'live' : m <= 15 ? 'delayed' : 'missing';
}

// ── viewport ────────────────────────────────────────────────────────────────────
export const SPAN_MIN = 30 * MIN, SPAN_MAX = 90 * 24 * 60 * MIN;
export const PERIODS = [
  { id: '3H', ms: 3 * 60 * MIN }, { id: '6H', ms: 6 * 60 * MIN }, { id: '12H', ms: 12 * 60 * MIN }, { id: '24H', ms: 24 * 60 * MIN },
  { id: '7D', ms: 7 * 1440 * MIN }, { id: '14D', ms: 14 * 1440 * MIN }, { id: '30D', ms: 30 * 1440 * MIN }, { id: '90D', ms: 90 * 1440 * MIN },
] as const;

export interface View { end: number; span: number }
export const clampSpan = (span: number) => Math.min(SPAN_MAX, Math.max(SPAN_MIN, span));

/** Zoom by `factor` (>1 = zoom out) keeping the time under `anchorFrac` (0..1 across the width) fixed. */
export function zoomAt(v: View, factor: number, anchorFrac: number): View {
  const span = clampSpan(v.span * factor);
  const tAnchor = v.end - v.span * (1 - anchorFrac);
  return { span, end: tAnchor + span * (1 - anchorFrac) };
}

/** Never scroll past "now" (plus a small margin so the newest dot is not on the edge). */
export const limitEnd = (end: number, now: number, span: number) => Math.min(end, now + span * 0.04);

/** Time ticks for the axis: a step that leaves ≥ `minPx` between labels, aligned to Kuwait local time (UTC+3). */
const KW = 3 * 60 * MIN;
const STEPS = [15, 30, 60, 120, 180, 360, 720, 1440, 2 * 1440, 7 * 1440, 14 * 1440].map((m) => m * MIN);
export function timeTicks(start: number, end: number, width: number, minPx = 64) {
  const step = STEPS.find((s) => (s / (end - start)) * width >= minPx) ?? STEPS[STEPS.length - 1];
  const out: number[] = [];
  for (let t = Math.ceil((start + KW) / step) * step - KW; t <= end; t += step) out.push(t);
  return { step, ticks: out };
}

export function tickLabel(t: number, step: number) {
  const d = new Date(t + KW);
  const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
  if (step < 1440 * MIN) return hh === '00' && mm === '00' ? `${d.getUTCDate()}/${d.getUTCMonth() + 1}` : `${hh}:${mm}`;
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/** Glucose axis (mg/dL): stable bounds that only grow when the data needs it, so the trace does not jump while panning. */
export function yDomain(maxVisible: number | null): [number, number] {
  return [40, maxVisible !== null && maxVisible > 280 ? 400 : 300];
}
