// iOS home-screen apps: after the keyboard closes, Safari can leave the layout viewport shifted, so the fixed tab bar
// sits halfway up the screen with the page showing under it. Re-anchoring the scroll position once nothing is being
// typed puts it back at the bottom. Harmless elsewhere: scrolling to where the page already is changes nothing.
const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

export function keepFixedBarsInPlace() {
  let timer = 0;
  const settle = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (typing()) return;
      const { scrollX: x, scrollY: y } = window;
      window.scrollTo(x, y + 1); window.scrollTo(x, y); // a 1-pixel nudge makes iOS lay the viewport out again
    }, 120);
  };
  document.addEventListener('focusout', settle);
  window.visualViewport?.addEventListener('resize', settle);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') settle(); });
  window.addEventListener('pageshow', settle);
}
