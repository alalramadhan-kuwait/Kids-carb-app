// The research lab's schedule, kept apart from the lab itself: the lab (its models and the importer they use) is only
// downloaded when a run is due, and the first check waits two minutes after the app opens, so opening the app (an
// alarm, a dose) never competes with it. It never touches doses or readings.
import { useEffect, useRef } from 'react';
import type { EventRow, HistoryEntry, Settings } from './types';

const MIN = 60000;
type RunInput = { settings: Settings; events: EventRow[]; history: HistoryEntry[] };

export function useLabRunner(input: RunInput & { loading: boolean }) {
  const latest = useRef(input); latest.current = input;
  const ready = !input.loading;
  useEffect(() => {
    if (!ready) return;
    const go = () => {
      if (document.visibilityState !== 'visible') return;
      const { settings, events, history } = latest.current;
      void import('./lab').then((m) => m.runLabIfDue({ settings, events, history })).catch(() => {});
    };
    const first = window.setTimeout(go, 2 * MIN), every = window.setInterval(go, 30 * MIN);
    return () => { window.clearTimeout(first); window.clearInterval(every); };
  }, [ready]);
}
