// Keep the screen on while the app is open (this phone's choice). With the screen on, the app stays in front, so the
// alarm sound can play. The phone gives the lock back whenever the app is hidden; it is asked again on return.
// Works on iPhone (iOS 16.4+; in a home-screen app, iOS 18.4+) and Android Chrome; elsewhere it does nothing.
import { useEffect, useState } from 'react';

const PREF = 'keep-awake-v1';
export const keepAwakeOn = () => { try { return localStorage.getItem(PREF) === 'on'; } catch { return false; } };
export function setKeepAwake(on: boolean) {
  try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* blocked: stays off */ }
  window.dispatchEvent(new Event(PREF));
}
export const keepAwakeSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;
export function useKeepAwakePref() {
  const [on, setOn] = useState(keepAwakeOn);
  useEffect(() => { const f = () => setOn(keepAwakeOn()); window.addEventListener(PREF, f); return () => window.removeEventListener(PREF, f); }, []);
  return on;
}

type Lock = { release: () => Promise<void>; released?: boolean };
/** Mounted once: holds the screen on while the switch is on and the app is visible. */
export function useKeepAwake() {
  const on = useKeepAwakePref();
  useEffect(() => {
    if (!on || !keepAwakeSupported()) return;
    let lock: Lock | null = null, stop = false;
    const ask = async () => {
      if (stop || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try { lock = await (navigator as unknown as { wakeLock: { request: (t: 'screen') => Promise<Lock> } }).wakeLock.request('screen'); } catch { /* refused (low battery, not allowed): try again later */ }
    };
    void ask();
    const vis = () => void ask();
    document.addEventListener('visibilitychange', vis);
    // some phones only allow it after a tap, and drop it now and then: ask again on taps and every minute
    document.addEventListener('pointerdown', vis, { passive: true });
    const id = setInterval(ask, 60000);
    return () => { stop = true; document.removeEventListener('visibilitychange', vis); document.removeEventListener('pointerdown', vis); clearInterval(id); void lock?.release().catch(() => undefined); };
  }, [on]);
}
