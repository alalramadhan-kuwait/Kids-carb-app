// One colour per kind of entry, used on buttons, icons and the graph rail so they are told apart at a glance.
// Glucose colours (red, green, amber) stay for glucose; the low treatment keeps the low colour because it is one.
// Class names are written out in full so Tailwind keeps them.
export type KindKey = 'insulin' | 'basal' | 'carbs' | 'meal' | 'treatment' | 'exercise' | 'sleep' | 'note';
export const KIND_STYLE: Record<KindKey, { solid: string; soft: string; icon: string; token: string }> = {
  insulin: { solid: 'bg-kins text-white', soft: 'bg-kins-soft text-kins', icon: 'bg-kins-soft text-kins', token: '--k-ins' },
  basal: { solid: 'bg-kins text-white', soft: 'bg-kins-soft text-kins', icon: 'bg-kins-soft text-kins', token: '--k-ins' },
  carbs: { solid: 'bg-kcarb text-white', soft: 'bg-kcarb-soft text-kcarb', icon: 'bg-kcarb-soft text-kcarb', token: '--k-carb' },
  meal: { solid: 'bg-kcarb text-white', soft: 'bg-kcarb-soft text-kcarb', icon: 'bg-kcarb-soft text-kcarb', token: '--k-carb' },
  treatment: { solid: 'bg-over-fill text-white', soft: 'bg-over-soft text-over', icon: 'bg-over-soft text-over', token: '--st-low' },
  exercise: { solid: 'bg-kex text-white', soft: 'bg-kex-soft text-kex', icon: 'bg-kex-soft text-kex', token: '--k-ex' },
  sleep: { solid: 'bg-ksleep text-white', soft: 'bg-ksleep-soft text-ksleep', icon: 'bg-ksleep-soft text-ksleep', token: '--k-sleep' },
  note: { solid: 'bg-knote text-white', soft: 'bg-knote-soft text-knote', icon: 'bg-knote-soft text-knote', token: '--k-note' },
};
