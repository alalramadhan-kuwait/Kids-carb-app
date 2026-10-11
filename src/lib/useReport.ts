// Loads exactly one report period from the database and builds the AGP report model from it. The patient details
// for the report header come from settings (the English name, diagnosis date and clinic are report-only fields).
import { useEffect, useMemo, useState } from 'react';
import { loadReportData, type ReportData } from './reportData';
import { buildAgpReport, reportPeriod, type PatientInfo, type ReportDays } from '../engine/report/agpReport';
import { buildWeeklySummary } from '../engine/report/weekly';
import { buildDailyLog } from '../engine/report/dailyLog';
import { buildSnapshot } from '../engine/report/snapshot';
import { buildMealtime } from '../engine/report/mealtime';
import { buildMonthly } from '../engine/report/monthly';
import { useData } from './data';
import { supabase } from './supabase';
import type { Settings } from './types';

/** Report-only settings, added by the doctor-reports migration. */
export type ReportSettings = Settings & { report_patient_name?: string | null; diagnosis_date?: string | null; clinic_name?: string | null };

export function usePatient(): PatientInfo {
  const { settings } = useData();
  const s = settings as ReportSettings;
  return { name: s.report_patient_name ?? null, birthDate: s.child_birth_date ?? null, birthApprox: !!s.child_birth_approx, diagnosisDate: s.diagnosis_date ?? null, clinic: s.clinic_name ?? null };
}

/** The date of birth stays marked approximate until someone ticks that it has been verified; editing it alone does not confirm it. */
export async function savePatient(p: PatientInfo, birthVerified: boolean) {
  const { error } = await supabase.from('settings').update({ report_patient_name: p.name, child_birth_date: p.birthDate, child_birth_approx: !birthVerified, diagnosis_date: p.diagnosisDate, clinic_name: p.clinic }).eq('id', true);
  if (error) throw new Error(error.message);
}

/** One report period's data, loaded once (exactly that period, from the database). */
export function useReportData(from: number, to: number) {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    loadReportData(from, to).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [from, to]);
  return { data, error, loading: !data && !error };
}

export function useAgpReport(days: ReportDays) {
  const [now] = useState(() => Date.now());
  const { from, to } = useMemo(() => reportPeriod(days, now), [days, now]);
  const { data, error, loading } = useReportData(from, to);
  const report = useMemo(() => (data ? buildAgpReport({ readings: data.readings, from, to, now, fingerPricks: data.fingerPricks.length }) : null), [data, from, to, now]);
  return { report, data, error, loading, now };
}

/** The Weekly Summary covers at most 14 days (two pages); a longer chosen period shows its last 14 days. */
export const WEEKLY_MAX_DAYS = 14;
export function useWeeklySummary(days: ReportDays) {
  const [now] = useState(() => Date.now());
  const shown = Math.min(days, WEEKLY_MAX_DAYS);
  const { from, to } = useMemo(() => reportPeriod(shown, now), [shown, now]);
  const { data, error, loading } = useReportData(from, to);
  const summary = useMemo(() => (data ? buildWeeklySummary({ ...data, from, to, now }) : null), [data, from, to, now]);
  return { summary, data, error, loading, now, shown, cut: days > WEEKLY_MAX_DAYS };
}

/** The Daily Log, one page per day, covers at most 14 days as well; a longer chosen period shows its last 14 days. */
export function useDailyLog(days: ReportDays) {
  const [now] = useState(() => Date.now());
  const shown = Math.min(days, WEEKLY_MAX_DAYS);
  const { from, to } = useMemo(() => reportPeriod(shown, now), [shown, now]);
  const { data, error, loading } = useReportData(from, to);
  const log = useMemo(() => (data ? buildDailyLog({ ...data, from, to, now }) : null), [data, from, to, now]);
  return { log, data, error, loading, now, shown, cut: days > WEEKLY_MAX_DAYS };
}

export function useSnapshot(days: ReportDays) {
  const [now] = useState(() => Date.now());
  const { from, to } = useMemo(() => reportPeriod(days, now), [days, now]);
  const { data, error, loading } = useReportData(from, to);
  const snap = useMemo(() => (data ? buildSnapshot({ ...data, from, to, now }) : null), [data, from, to, now]);
  return { snap, data, error, loading, now };
}

export function useMealtime(days: ReportDays) {
  const [now] = useState(() => Date.now());
  const { from, to } = useMemo(() => reportPeriod(days, now), [days, now]);
  const { data, error, loading } = useReportData(from, to);
  const mt = useMemo(() => (data ? buildMealtime({ ...data, from, to, now }) : null), [data, from, to, now]);
  return { mt, error, loading, now, from, to };
}

export function useMonthly(days: ReportDays) {
  const [now] = useState(() => Date.now());
  const { from, to } = useMemo(() => reportPeriod(days, now), [days, now]);
  const { data, error, loading } = useReportData(from, to);
  const monthly = useMemo(() => (data ? buildMonthly({ ...data, from, to, now }) : null), [data, from, to, now]);
  return { monthly, data, error, loading, now };
}
