/**
 * Every icon in the app, drawn once here. 24 × 24 grid, 2 px round stroke, currentColor.
 * `npm run icons` writes each one to public/assets/ as a standalone SVG for designers.
 * Rules: DESIGN_SYSTEM.md §8 — one family, no faces, medical colours only on status icons.
 */

export interface IconDef {
  /** stroked outline paths */
  d: string[];
  /** closed shapes that get a soft fill when the icon is "active" */
  fillable?: string[];
  /** small solid dots (filled with currentColor) */
  dots?: [number, number, number][];
}

export const ICONS = {
  // ── navigation (06_navigation) ──
  home: { d: ['M4 10.6 12 4l8 6.6V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19z'], fillable: ['M4 10.6 12 4l8 6.6V19a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19z'] },
  history: { d: ['M3.6 12A8.4 8.4 0 1 0 6 6.1', 'M3.5 4v3.9h3.9', 'M12 7.8V12l3 2'], fillable: ['M12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 0 1 0-16.8z'] },
  meals: { d: ['M5 3v5a3 3 0 0 0 6 0V3', 'M8 3v18', 'M17.5 3c-1.9 0-3.2 2.1-3.2 4.6s1.3 4.4 3.2 4.4 3.2-1.9 3.2-4.4S19.4 3 17.5 3z', 'M17.5 12v9'], fillable: ['M17.5 3c-1.9 0-3.2 2.1-3.2 4.6s1.3 4.4 3.2 4.4 3.2-1.9 3.2-4.4S19.4 3 17.5 3z'] },
  products: { d: ['M5 8h14l-1.2 11.6a1.5 1.5 0 0 1-1.5 1.4H7.7a1.5 1.5 0 0 1-1.5-1.4z', 'M9 10V7a3 3 0 0 1 6 0v3'], fillable: ['M5 8h14l-1.2 11.6a1.5 1.5 0 0 1-1.5 1.4H7.7a1.5 1.5 0 0 1-1.5-1.4z'] },
  advanced: { d: ['M5 20v-5', 'M10 20V9', 'M15 20v-8', 'M20 20V4'], fillable: [] },
  more: { d: [], dots: [[5, 12, 1.9], [12, 12, 1.9], [19, 12, 1.9]] },

  // ── logging & features ──
  glucose: { d: ['M12 3.2s6.5 7 6.5 11.4a6.5 6.5 0 0 1-13 0C5.5 10.2 12 3.2 12 3.2z'], fillable: ['M12 3.2s6.5 7 6.5 11.4a6.5 6.5 0 0 1-13 0C5.5 10.2 12 3.2 12 3.2z'] },
  insulin: { d: ['M16 3.5l4.5 4.5', 'M18.2 5.8 8.6 15.4l-3.9 1 1-3.9 9.6-9.6', 'M11.4 9.4l3.2 3.2', 'M4.7 16.4 3 18.2'] },
  carbs: { d: ['M4 12h16a8 8 0 0 1-16 0z', 'M7 8.5c1-1.5 3-1.5 4 0s3 1.5 4 0'], fillable: ['M4 12h16a8 8 0 0 1-16 0z'] },
  treatment: { d: ['M7 8h10l-1.1 12a1.5 1.5 0 0 1-1.5 1.4H9.6a1.5 1.5 0 0 1-1.5-1.4z', 'M12 8l1.5-5h3', 'M7.5 12.5h9'], fillable: ['M7 8h10l-1.1 12a1.5 1.5 0 0 1-1.5 1.4H9.6a1.5 1.5 0 0 1-1.5-1.4z'] },
  activity: { d: ['M13.5 5.5a1.8 1.8 0 1 0 0-.01', 'M8 21l3-6 3 2v5', 'M6 11l3-3h4l2 3 3 1', 'M11 15l1-6'] },
  note: { d: ['M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M14.5 3v4.5H19', 'M8.5 12.5h7', 'M8.5 16.5h4.5'] },
  sensor: { d: ['M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16z'], dots: [[12, 12, 2.2]] },
  user: { d: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M6.7 18.4a6.4 6.4 0 0 1 10.6 0'] },
  bell: { d: ['M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z', 'M10 21a2.2 2.2 0 0 0 4 0'] },
  moon: { d: ['M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z'] },
  school: { d: ['M2.5 9.5 12 5l9.5 4.5L12 14z', 'M6.5 11.5v4.5c3 2.2 8 2.2 11 0v-4.5', 'M21.5 9.5V15'] },
  family: { d: ['M9 4.5a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6z', 'M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6', 'M16 5a3.2 3.2 0 0 1 0 6', 'M18 14.3c2.2.6 3.5 2.6 3.5 5.7'] },
  settings: { d: ['M4 7h9', 'M19 7h1', 'M4 17h3', 'M13 17h7', 'M16 4.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z', 'M10 14.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z'] },
  plus: { d: ['M12 5v14', 'M5 12h14'] },
  check: { d: ['M5 12.5l4.5 4.5L19 7.5'] },
  camera: { d: ['M4 8h3l1.5-2.5h7L17 8h3v11H4z', 'M12 10.5a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z'] },
  heart: { d: ['M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z'], fillable: ['M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z'] },

  // ── trend arrows (07_status) — the Libre convention: straight = fast, diagonal = moderate ──
  trend_rising_fast: { d: ['M12 20V4.5', 'M6 10.5l6-6 6 6'] },
  trend_rising: { d: ['M6 18L18 6', 'M9 6h9v9'] },
  trend_stable: { d: ['M4 12h15.5', 'M13.5 6l6 6-6 6'] },
  trend_falling: { d: ['M6 6l12 12', 'M18 9v9H9'] },
  trend_falling_fast: { d: ['M12 4v15.5', 'M6 13.5l6 6 6-6'] },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** Glucose status: a drop with a white mark inside. No faces. Shape + mark + words, never colour alone. */
const DROP = 'M12 2.6s7 7.5 7 12.2a7 7 0 0 1-14 0C5 10.1 12 2.6 12 2.6z';
export const STATUS = {
  urgent_low: { color: '#C83E4D', token: '--drop-urgent', mark: ['M9 10.5l3 3 3-3', 'M9 14.5l3 3 3-3'], label: 'منخفض جدًا' },
  low: { color: '#E95F68', token: '--drop-low', mark: ['M9 13l3 3 3-3'], label: 'منخفض' },
  in_range: { color: '#46B98A', token: '--drop-in', mark: ['M8.8 14.8l2.3 2.3 4.2-4.6'], label: 'ضمن النطاق' },
  high: { color: '#F2A541', token: '--drop-high', mark: ['M9 16l3-3 3 3'], label: 'مرتفع' },
  very_high: { color: '#D9822B', token: '--drop-vhigh', mark: ['M9 14l3-3 3 3', 'M9 18l3-3 3 3'], label: 'مرتفع جدًا' },
} as const;
export type StatusName = keyof typeof STATUS;
export const DROP_PATH = DROP;

const esc = (n: number) => +n.toFixed(2);

/** Standalone SVG markup (used by the export script and the preview sheet). */
export function iconSvg(name: IconName, opts: { active?: boolean; size?: number } = {}): string {
  const def: IconDef = ICONS[name];
  const s = opts.size ?? 24;
  const fills = opts.active ? (def.fillable ?? []).map((p) => `<path d="${p}" fill="currentColor" fill-opacity=".18" stroke="none"/>`).join('') : '';
  const strokes = def.d.map((p) => `<path d="${p}"/>`).join('');
  const dots = (def.dots ?? []).map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${esc(r)}" fill="currentColor" stroke="none"/>`).join('');
  const w = opts.active ? 2.3 : 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${fills}${strokes}${dots}</svg>`;
}

export function statusSvg(name: StatusName, size = 24): string {
  const st = STATUS[name];
  const mark = st.mark.map((p) => `<path d="${p}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${DROP}" fill="var(${st.token}, ${st.color})"/><g fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${mark}</g></svg>`;
}
