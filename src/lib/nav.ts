import type { NavigateFunction } from 'react-router-dom';

/** Back one step when there is a step in this app to go back to; otherwise (opened from a link or the home screen)
 *  to `home`, so the back arrow never leaves the app. */
export const backTo = (nav: NavigateFunction, home: string) => {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) nav(-1); else nav(home, { replace: true });
};
