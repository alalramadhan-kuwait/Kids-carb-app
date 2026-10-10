// Maps the doctor reports' database reply (carb.report_data) to the report engine's inputs. Pure, so it is tested;
// rows are mapped, never altered.
import type { Reading } from '../engine/report/cgm';
import type { FingerPrick, ReportInsulin, ReportMeal, ReportTreatment } from '../engine/report/days';

export interface ReportData {
  from: number; to: number;
  readings: Reading[]; sources: (string | null)[];
  insulin: ReportInsulin[]; meals: ReportMeal[]; treatments: ReportTreatment[]; fingerPricks: FingerPrick[];
  sensors: { sn: string; started_at: string; days: number | null; source: string | null }[];
}

/** Turns the database reply into engine inputs. Carbs-only entries count as food; a meal saved with unknown carbs
 *  stays unknown (its stored 0 is not a measurement). */
export function mapReportData(j: any, from: number, to: number): ReportData {
  const t: number[] = j?.readings?.t ?? [], mg: number[] = j?.readings?.mg ?? [];
  const ms = (s: string) => Date.parse(s);
  const ev: any[] = j?.events ?? [];
  return {
    from, to,
    readings: t.map((x, i) => ({ t: x * 1000, mg: Number(mg[i]) })), sources: j?.readings?.src ?? [],
    insulin: ev.filter((e) => e.kind === 'insulin' && Number(e.units) > 0).map((e) => ({ at: ms(e.at), units: Number(e.units), type: e.type === 'long' ? 'long' : 'rapid', purpose: e.purpose ?? null })),
    meals: [
      ...(j?.meals ?? []).map((m: any) => ({ at: ms(m.at), carbs: m.unknown ? null : Number(m.carbs), unknown: !!m.unknown, pending: !!m.pending, name: m.name ?? null, slot: m.slot ?? null })),
      ...ev.filter((e) => e.kind === 'carbs' && e.carbs != null).map((e) => ({ at: ms(e.at), carbs: Number(e.carbs), unknown: false, pending: false, name: null, slot: null })),
    ].sort((a, b) => a.at - b.at),
    treatments: ev.filter((e) => e.kind === 'treatment').map((e) => ({ at: ms(e.at), carbs: e.carbs == null ? null : Number(e.carbs), name: e.treatment ?? null })),
    fingerPricks: ev.filter((e) => e.kind === 'bg_check' && e.bg).map((e) => ({ at: ms(e.at), mg: Number(e.bg) })),
    sensors: j?.sensors ?? [],
  };
}
