// Ordering of the frequent foods on the Log sheet. Pure, so it is tested in Node.

/**
 * Most used first: how often the food was logged (her history, whatever way it was logged, or one-tap uses, whichever
 * is higher, as one tap adds to both), then the most recent, then by name.
 */
export function rankQuick<T extends { name: string; uses: number; last_used: string | null }>(items: T[], history: { name: string }[]): T[] {
  const logged = new Map<string, number>();
  for (const h of history) logged.set(h.name, (logged.get(h.name) ?? 0) + 1);
  const score = (q: T) => Math.max(q.uses, logged.get(q.name) ?? 0);
  const last = (q: T) => (q.last_used ? Date.parse(q.last_used) : 0);
  return [...items].sort((a, b) => score(b) - score(a) || last(b) - last(a) || a.name.localeCompare(b.name));
}
