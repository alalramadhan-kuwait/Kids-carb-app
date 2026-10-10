// Injection-site rotation shared by both modes: which sites are allowed for a pen (the care team's list, minus the
// site the sensor is on), when each was last used, and the next one in the rotation.
import { useData } from './data';
import { useSensor } from './mom';
import { SITES, siteSuggestion, type Shot } from '../engine/mom';
import type { EventRow, InjectionSite, Settings } from './types';

export const ALL6: InjectionSite[] = ['arm_r', 'arm_l', 'belly_r', 'belly_l', 'thigh_r', 'thigh_l'];

/** The sites allowed for this pen (both pens when null), never the sensor's. */
export const allowedSites = (settings: Settings, type: 'rapid' | 'long' | null, sensor: InjectionSite | null = null) =>
  (type ? settings.injection_sites?.[type] ?? ALL6 : [...new Set([...(settings.injection_sites?.rapid ?? ALL6), ...(settings.injection_sites?.long ?? ALL6)])])
    .filter((x) => SITES.includes(x) && x !== sensor);

/** Every insulin dose as a rotation shot (any pen: a site rests whichever insulin went into it). */
export const shotsOf = (events: EventRow[], exclude: string | null = null): Shot[] =>
  events.filter((e) => e.kind === 'insulin' && !e.deleted_at && e.id !== exclude)
    .map((e) => ({ t: Date.parse(e.occurred_at), site: e.injection_site ?? null, type: e.insulin_type === 'long' ? 'long' : 'rapid' }));

export type SiteRotation = ReturnType<typeof useSiteRotation>;
/** The rotation for one pen now: the suggestion, when each site was last used, the allowed sites and the sensor's. */
export function useSiteRotation(type: 'rapid' | 'long', exclude: string | null = null) {
  const { events, settings } = useData();
  const sensor = useSensor()?.site ?? null;
  const allowed = allowedSites(settings, type, sensor);
  return { ...siteSuggestion(shotsOf(events, exclude), allowed), allowed, sensor };
}
