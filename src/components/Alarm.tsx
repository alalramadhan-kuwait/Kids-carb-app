// The alarm: while a very low, low, high or no-reading alert is open and nobody has answered it, this phone plays a
// loud repeating sound and shows a full-screen flashing card until someone taps «أنا عليها» (that answers the alert
// for everyone). The phone also checks by itself: no new reading for 15 minutes, or no connection to the server for
// 15 minutes, sounds too. Sound plays only while the app is open on screen (a phone's browser cannot play it in the
// background): the server's pushes and the LibreLinkUp app's own alarms stay the backup.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ackAlert } from '../lib/push';
import { useData } from '../lib/data';
import { formatGlucose } from '../lib/glucose';
import type { AlertKind, AlertRow } from '../lib/types';
import { t } from '../i18n';

const MIN = 60000, STALE_MIN = 15;
export type AlarmLevel = 'urgent' | 'low' | 'nodata' | 'high';
const LEVEL_OF: Partial<Record<AlertKind, AlarmLevel>> = { urgent_low: 'urgent', low: 'low', no_data: 'nodata', high: 'high' };
const ORDER: AlarmLevel[] = ['urgent', 'low', 'nodata', 'high'];

/* ------------------------------------------------------------ this phone's switch */
const PREF = 'alarm-sound-v1';
export const alarmSoundOn = () => { try { return localStorage.getItem(PREF) !== 'off'; } catch { return true; } };
export function setAlarmSound(on: boolean) {
  try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* blocked: stays on */ }
  window.dispatchEvent(new Event(PREF));
}
export function useAlarmSound() {
  const [on, setOn] = useState(alarmSoundOn);
  useEffect(() => { const f = () => setOn(alarmSoundOn()); window.addEventListener(PREF, f); return () => window.removeEventListener(PREF, f); }, []);
  return on;
}

/* ------------------------------------------------------------ the sound (Web Audio, no files) */
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (ctx) return ctx;
  const A = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!A) return null;
  // iPhone: play even with the ring switch on silent (Safari 16.4+)
  try { (navigator as unknown as { audioSession?: { type: string } }).audioSession!.type = 'playback'; } catch { /* older phones */ }
  ctx = new A();
  return ctx;
}
/** Phones only allow sound after a tap: the first tap anywhere unlocks it for the rest of the visit. */
function unlockOnTap() {
  const go = () => { const c = audio(); if (c && c.state !== 'running') void c.resume(); };
  document.addEventListener('pointerdown', go, { passive: true });
  document.addEventListener('touchend', go, { passive: true });
  return () => { document.removeEventListener('pointerdown', go); document.removeEventListener('touchend', go); };
}
const soundReady = () => !!ctx && ctx.state === 'running';
// [frequency Hz (0 = silence), seconds]; then the pattern repeats after `every` seconds
const PATTERN: Record<AlarmLevel, { notes: [number, number][]; every: number; vol: number; buzz: number[] }> = {
  urgent: { notes: [[988, 0.16], [0, 0.07], [988, 0.16], [0, 0.07], [988, 0.16], [0, 0.07], [1318, 0.3]], every: 1.4, vol: 0.9, buzz: [300, 100, 300, 100, 300] },
  low: { notes: [[784, 0.25], [0, 0.15], [784, 0.25], [0, 0.15], [1047, 0.35]], every: 2.2, vol: 0.8, buzz: [400, 200, 400] },
  nodata: { notes: [[523, 0.35], [0, 0.1], [392, 0.45]], every: 5, vol: 0.7, buzz: [500, 300, 500] },
  high: { notes: [[523, 0.3], [659, 0.3], [784, 0.4]], every: 6, vol: 0.5, buzz: [250, 150, 250] },
};
function play(level: AlarmLevel) {
  const c = audio();
  try { navigator.vibrate?.(PATTERN[level].buzz); } catch { /* no vibration */ }
  if (!c || c.state !== 'running') return;
  let at = c.currentTime + 0.02;
  for (const [f, d] of PATTERN[level].notes) {
    if (f) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(PATTERN[level].vol, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + d);
      o.connect(g).connect(c.destination); o.start(at); o.stop(at + d + 0.02);
    }
    at += d;
  }
}
/** One play of a level's sound, for «جربي الصوت». */
export function testAlarm(level: AlarmLevel = 'low') { const c = audio(); if (c && c.state !== 'running') void c.resume().then(() => play(level)); else play(level); }

/* ------------------------------------------------------------ what is sounding */
/** Open alerts nobody has answered yet (their own live channel, separate from the strip's). */
function useUnanswered() {
  const [list, setList] = useState<AlertRow[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('alerts').select('*').eq('state', 'active');
    setList(((data ?? []) as AlertRow[]).filter((a) => LEVEL_OF[a.kind]));
  }, []);
  useEffect(() => {
    void load();
    const ch = supabase.channel('alerts-alarm').on('postgres_changes', { event: '*', schema: 'carb', table: 'alerts' }, () => void load()).subscribe();
    const id = setInterval(load, 30000);
    const vis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', vis);
    return () => { void supabase.removeChannel(ch); clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [load]);
  return { list, reload: load };
}
/** This phone's own check: when the newest reading is, and when the server last answered. */
function useFreshness() {
  const [s, set] = useState<{ reading: number | null; ok: number }>({ reading: null, ok: Date.now() });
  useEffect(() => {
    const check = async () => {
      const r = await supabase.from('glucose_readings').select('taken_at').order('taken_at', { ascending: false }).limit(1).maybeSingle();
      if (r.error) return; // no connection: `ok` stays at the last good answer
      set({ reading: r.data ? Date.parse((r.data as { taken_at: string }).taken_at) : null, ok: Date.now() });
    };
    void check();
    const id = setInterval(check, 60000);
    const vis = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return s;
}

/** The full-screen alarm, mounted once for the whole app. */
export function Alarm() {
  const { settings } = useData();
  const soundOn = useAlarmSound();
  const { list, reload } = useUnanswered();
  const fresh = useFreshness();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(soundReady());
  // a local «تمام» on the phone's own no-reading alarm lasts until a new reading (or 30 minutes)
  const [quiet, setQuiet] = useState<{ reading: number | null; until: number } | null>(null);
  useEffect(() => unlockOnTap(), []);
  useEffect(() => { const id = setInterval(() => { setNow(Date.now()); setReady(soundReady()); }, 1000); return () => clearInterval(id); }, []);

  const server = [...list].sort((a, b) => ORDER.indexOf(LEVEL_OF[a.kind]!) - ORDER.indexOf(LEVEL_OF[b.kind]!))[0] ?? null;
  const offline = now - fresh.ok > STALE_MIN * MIN;
  const staleMin = fresh.reading === null ? null : Math.floor((now - fresh.reading) / MIN);
  // readings were coming in (within 6 hours) and stopped; a sensor that is off or not connected does not ring all day
  const localStale = offline || (staleMin !== null && staleMin >= STALE_MIN && staleMin < 6 * 60);
  const localQuiet = quiet && quiet.reading === fresh.reading && now < quiet.until;
  const level: AlarmLevel | null = server ? LEVEL_OF[server.kind]! : localStale && !localQuiet ? 'nodata' : null;

  // the sound: repeats while the alarm is up and this phone's switch is on
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (!level || !soundOn) return;
    play(level);
    timer.current = window.setInterval(() => play(level), PATTERN[level].every * 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [level, soundOn, ready]);

  if (!level) return null;
  const unit = settings.glucose_unit;
  const title = level === 'urgent' ? t('منخفض جدًا') : level === 'low' ? t('منخفض') : level === 'high' ? t('مرتفع') : offline && !server ? t('ما في اتصال') : t('ما في قراءة');
  const sub = level === 'nodata'
    ? (offline && !server ? t('من {m} د', { m: Math.floor((now - fresh.ok) / MIN) }) : staleMin !== null ? t('من {m} د', { m: staleMin }) : '')
    : server?.value_mgdl ? formatGlucose(server.value_mgdl, unit) : '';
  const todo = level === 'urgent' || level === 'low' ? t('عطيها عصير الحين') : level === 'high' ? t('شوفي خطة الدكتور') : t('افحصيها بالإصبع');
  const bg = level === 'urgent' ? ['#b4232f', '#e0414d'] : level === 'low' ? ['#c62f3a', '#ef6b75'] : level === 'high' ? ['#b86e00', '#e19a2a'] : ['#475569', '#64748b'];
  const answer = async () => {
    if (server) {
      setBusy(true);
      try { await ackAlert(server.id, 'on_it'); } catch { /* offline: try again */ }
      await reload(); setBusy(false);
    } else setQuiet({ reading: fresh.reading, until: Date.now() + 30 * MIN });
  };
  return (
    <div role="alertdialog" aria-live="assertive" className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))] text-center"
      style={{ color: '#fff', animation: 'alarm-flash 1s steps(1) infinite', ['--a' as string]: bg[0], ['--b' as string]: bg[1] }}>
      <style>{'@keyframes alarm-flash { 0% { background: var(--a); } 50% { background: var(--b); } }'}</style>
      <div className="text-[72px] leading-none">{level === 'high' ? '⬆️' : level === 'nodata' ? '📡' : '⚠️'}</div>
      <div className="text-[40px] font-extrabold leading-tight">{title}</div>
      {sub && <div dir="ltr" className="text-[44px] font-extrabold leading-none">{sub}</div>}
      <div className="text-[22px] font-bold opacity-95">{todo}</div>
      {soundOn && !ready && <div className="rounded-2xl bg-black/25 px-4 py-2 text-[17px] font-bold">🔊 {t('اضغطي أي مكان لتشغيل الصوت')}</div>}
      <button disabled={busy} onClick={answer} className="mt-4 min-h-[76px] w-full max-w-sm rounded-3xl text-[26px] font-extrabold disabled:opacity-60" style={{ color: bg[0], background: '#fff' }}>
        {server ? t('أنا عليها') : t('تمام')}
      </button>
    </div>
  );
}
