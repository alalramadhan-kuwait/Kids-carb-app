// Places small labels along a time axis without overlap, the same way on the screen and in the PDFs: items go in time
// order onto the first of `lines` lines with room; if none has room, onto the line that frees up first, moved right
// to the first free spot. The marker itself always stays at the true time; only the label moves.
export interface Placed { line: number; lx: number }
export function placeLabels(items: { x: number; w: number }[], lines = 2, gap = 0): Placed[] {
  const ends = Array.from({ length: lines }, () => -Infinity);
  return items.map(({ x, w }) => {
    let line = ends.findIndex((e) => e <= x);
    if (line < 0) line = ends.indexOf(Math.min(...ends));
    const lx = Math.max(x, ends[line]);
    ends[line] = lx + w + gap;
    return { line, lx };
  });
}
