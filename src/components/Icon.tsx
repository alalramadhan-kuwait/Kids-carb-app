import { DROP_PATH, ICONS, STATUS, type IconDef, type IconName, type StatusName } from '../icons/defs';

/** Line icon in the current text colour. `active` adds the soft fill used for the selected tab. */
export function Icon({ name, size = 24, active, className, label }: { name: IconName; size?: number; active?: boolean; className?: string; label?: string }) {
  const def: IconDef = ICONS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.3 : 2}
      strokeLinecap="round" strokeLinejoin="round" className={className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {active && (def.fillable ?? []).map((p) => <path key={'f' + p} d={p} fill="currentColor" fillOpacity={0.18} stroke="none" />)}
      {def.d.map((p) => <path key={p} d={p} />)}
      {(def.dots ?? []).map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />)}
    </svg>
  );
}

/** Glucose status drop (no face). Always shown next to the number and the words. */
export function StatusIcon({ name, size = 20 }: { name: StatusName; size?: number }) {
  const st = STATUS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d={DROP_PATH} fill={`var(${st.token}, ${st.color})`} />
      <g fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{st.mark.map((p) => <path key={p} d={p} />)}</g>
    </svg>
  );
}

/** LibreLinkUp trend 1–5 → icon (Libre convention: straight arrows are the fast ones). */
export const TREND_ICON: Record<number, IconName> = {
  1: 'trend_falling_fast', 2: 'trend_falling', 3: 'trend_stable', 4: 'trend_rising', 5: 'trend_rising_fast',
};
export const TREND_WORDS: Record<number, string> = { 1: 'نازل بسرعة', 2: 'نازل', 3: 'ثابت', 4: 'صاعد', 5: 'صاعد بسرعة' };
