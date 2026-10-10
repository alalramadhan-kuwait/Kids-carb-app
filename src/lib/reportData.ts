// The doctor reports' data: exactly the chosen period, read with one database call (carb.report_data), never from the
// app's 60-day cache, so 30- and 90-day reports are complete.
import { supabase } from './supabase';
import { mapReportData, type ReportData } from './reportMap';

export type { ReportData };
export async function loadReportData(from: number, to: number): Promise<ReportData> {
  const { data, error } = await supabase.rpc('report_data', { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
  if (error) throw new Error(error.message);
  return mapReportData(data, from, to);
}
