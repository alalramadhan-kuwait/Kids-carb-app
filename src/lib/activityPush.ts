// Shared activity pushes: which of the other parent's entries this person wants to hear about. Stored per person
// (carb.members.activity_push); a kind with no setting is on. The server sends them (carb-glucose activityPushes).
import { supabase } from './supabase';
import type { Member } from './types';

export type ActivityKind = 'meal' | 'rapid' | 'long' | 'treatment' | 'finger';
export const ACTIVITY_KINDS: { k: ActivityKind; icon: string; label: string }[] = [
  { k: 'rapid', icon: '💉', label: 'نوفورابيد' }, // i18n-ok: translated where shown
  { k: 'long', icon: '💉', label: 'تريسيبا' }, // i18n-ok
  { k: 'meal', icon: '🍽️', label: 'وجبة' }, // i18n-ok
  { k: 'treatment', icon: '🧃', label: 'علاج انخفاض' }, // i18n-ok
  { k: 'finger', icon: '🩸', label: 'قياس وخز' }, // i18n-ok
];

export const activityOn = (m: Member | null | undefined, k: ActivityKind) => m?.activity_push?.[k] !== false;

export async function setActivityPush(m: Member | null | undefined, k: ActivityKind, on: boolean) {
  const p = Object.fromEntries(ACTIVITY_KINDS.map((x) => [x.k, x.k === k ? on : activityOn(m, x.k)]));
  const { error } = await supabase.rpc('set_activity_push', { p });
  if (error) throw new Error(error.message);
}
