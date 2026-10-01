// This phone's alert notifications: permission, Web Push subscription, and saving it for the server.
import { supabase } from './supabase';
import { callGlucose } from './api';
import { t } from '../i18n';

export type PushState = 'unsupported' | 'needs_install' | 'denied' | 'off' | 'on';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export async function registerSw() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }); }
  catch { return null; }
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return 'needs_install'; // iPhone: only from the home-screen app
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

const keyBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/android/i.test(ua)) return 'Android';
  return t('متصفح');
}

/** Must be called from a tap (browsers require a user gesture for the permission prompt). */
export async function enablePush(): Promise<PushState> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = (await registerSw()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  const { publicKey } = (await callGlucose({ action: 'push_key' })) as unknown as { publicKey: string };
  if (!publicKey) throw new Error('no key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const j = sub.toJSON();
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: j.endpoint, p256dh: j.keys!.p256dh, auth: j.keys!.auth, device_label: deviceLabel(), user_id: u.user!.id },
    { onConflict: 'endpoint' },
  );
  if (error) throw new Error(error.message);
  return 'on';
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
}

export const testPush = async () => (await callGlucose({ action: 'test_push' })) as unknown as { sent: number; ok: number };
export const ackAlert = async (id: string, ack: 'on_it' | 'treated', snooze_min = 15) =>
  callGlucose({ action: 'ack', id, ack, snooze_min }) as unknown as Promise<{ ok?: boolean; error?: string }>;
