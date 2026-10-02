// The research lab in the database. Every 12 hours one phone (whichever opens the app first in that slot) runs the
// lab on the last 60 days and stores the run, the unexplained movements and at most a few questions. Research
// never writes to doses, readings, settings or alerts; a parent's answer only changes research data (and, for a
// possible double entry, the entry's import status, which is reversible on the import page).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { decide } from './importGluroo';
import { arrowSource } from './arrowChoice';
import { ratioAt } from '../engine/status';
import { LAB_CODE_VERSION, REGISTRY, kuwaitDay, pickQuestions, runLab, type AnswerChoice, type Cause, type Confidence, type LabResult, type ModelScore, type Verdict } from '../engine/lab';
import type { EventRow, HistoryEntry, Settings } from './types';

// BACK stays under 31 days: glucose_series_arrows returns nothing for a longer window (the auto runs read 0 readings
// with 60 days, 2026-10-02)
const MIN = 60000, HOUR = 3600000, DAY = 86400000, SLOT = 12 * HOUR, BACK = 30 * DAY;
export const slotOf = (t: number) => Math.floor(t / SLOT) * SLOT;

export interface RunRow {
  id: string; slot: string | null; trigger: 'auto' | 'manual' | 'baseline'; label: string | null; status: 'running' | 'done' | 'failed';
  started_at: string; finished_at: string | null; window_from: string | null; window_to: string | null; unseen_from: string | null;
  data: (LabResult['data'] & { shared?: number; days?: number }) | null;
  metrics: { all: Record<string, ModelScore>; bySituation?: LabResult['unseen']['bySituation']; after_food_mae15?: Record<string, number> } | null;
  choices: LabResult['choices'] | null; verdicts: LabResult['verdicts'] | null; error: string | null;
}
export interface ModelRow { key: string; version: number; name: string; note: string | null; role: string; status: Verdict | 'production' | 'reference' | 'retired'; status_reason: string | null; status_at: string; created_at: string }
export interface UnexplainedRow {
  key: string; start_at: string; end_at: string; direction: 'rise' | 'fall'; g_from: number; g_to: number; expected_mgdl: number; resid_mgdl: number;
  iob: number | null; cob: number | null; night: boolean; auto_cause: Cause; cause: Cause; confidence: Confidence; evidence: string[]; info: number;
  answer: { choice: AnswerChoice; note?: string } | null; answered_at: string | null;
}
export interface QuestionRow { id: string; kind: 'unexplained' | 'duplicate'; ref: string; info: number; status: string; created_at: string }

interface RunInput { settings: Settings; events: EventRow[]; history: HistoryEntry[] }

/** Everything the lab needs, from the app's data and the database; null when the doctor's ratios are missing. */
async function gather({ settings: s, events, history }: RunInput, now: number) {
  const ratio = ratioAt(s.ratios ?? [], 12 * 60) ?? (s.ratios ?? [])[0];
  if (!ratio) return null;
  const from = now - BACK;
  const [series, unc, sensors, fps, answered] = await Promise.all([
    supabase.rpc('glucose_series_arrows', { p_from: new Date(from).toISOString(), p_to: new Date(now).toISOString() }),
    supabase.from('import_entries').select('id,occurred_at').eq('status', 'uncertain').eq('entry_type', 'ANNOUNCE_MEAL').gte('occurred_at', new Date(from).toISOString()),
    supabase.from('sensors').select('started_at'),
    supabase.from('bg_comparisons').select('taken_at,cause'),
    supabase.from('unexplained_events').select('key,answer').not('answer', 'is', null),
  ]);
  if (series.error || !series.data) throw new Error(series.error?.message ?? 'no_readings');
  const d = series.data as { t: number[]; v: number[]; a: (number | null)[] };
  if (!d.t.length) throw new Error('no_readings'); // an empty window is a failed run, never a run that scored nothing
  const live = events.filter((e) => !e.deleted_at);
  const uncertain = ((unc.data ?? []) as { id: string; occurred_at: string }[]).map((u) => ({ id: u.id, t: Date.parse(u.occurred_at) }));
  return {
    readings: d.t.map((x, i) => ({ t: x * 1000, v: d.v[i], a: d.a[i] })),
    ctx: {
      doses: live.filter((e) => e.kind === 'insulin' && e.insulin_type !== 'long' && e.insulin_units).map((e) => ({ t: Date.parse(e.occurred_at), u: e.insulin_units! })),
      carbs: [
        ...history.map((h) => ({ t: Date.parse(h.eaten_at), g: h.total_carbs, fpu: ((h.total_fat ?? 0) * 9 + (h.total_protein ?? 0) * 4) / 100 })),
        ...live.filter((e) => (e.kind === 'carbs' || e.kind === 'treatment') && e.carbs_g).map((e) => ({ t: Date.parse(e.occurred_at), g: e.carbs_g! })),
      ],
      iob: { dia: s.iob_dia_min ?? 360, peak: s.iob_peak_min ?? 65 }, absorb: s.cob_absorb_min ?? 180, cr: ratio.cr, isf: ratio.isf,
    },
    clues: {
      uncertain: uncertain.map((u) => u.t),
      sensorStarts: ((sensors.data ?? []) as { started_at: string }[]).map((x) => Date.parse(x.started_at)),
      fingerpricks: ((fps.data ?? []) as { taken_at: string; cause: string | null }[]).filter((f) => f.cause).map((f) => ({ t: Date.parse(f.taken_at), cause: f.cause! })),
      exercise: live.filter((e) => e.kind === 'exercise').map((e) => Date.parse(e.occurred_at)),
    },
    uncertain,
    answers: Object.fromEntries(((answered.data ?? []) as { key: string; answer: { choice: AnswerChoice } }[]).map((a) => [a.key, a.answer.choice])),
  };
}

/** Runs the lab and stores the results under `runId`. */
async function execute(runId: string, input: RunInput, now: number) {
  try {
    const g = await gather(input, now);
    if (!g) { await supabase.from('research_runs').update({ status: 'failed', error: 'no_ratios', finished_at: new Date().toISOString() }).eq('id', runId); return; }
    const { data: base } = await supabase.from('research_runs').select('unseen_from').eq('trigger', 'baseline').order('started_at').limit(1);
    const baselineEnd = base?.[0]?.unseen_from ? Date.parse(base[0].unseen_from) : now - 7 * DAY;
    const r = runLab({ ...g, baselineEnd, production: arrowSource() === 'ours' ? 'trend' : 'libre', now });
    const iso = (x: number) => new Date(x).toISOString();

    // the registry: new versions appear by themselves; candidate status follows the verdict, every change dated
    await supabase.from('research_models').upsert(REGISTRY.map((m) => ({ key: m.key, version: m.version, name: m.name, note: m.note, params: m.params, role: m.role,
      status: m.role === 'candidate' ? 'collecting' : m.role })), { onConflict: 'key,version', ignoreDuplicates: true });
    const { data: models } = await supabase.from('research_models').select('key,version,status,status_reason');
    for (const m of REGISTRY.filter((x) => x.role === 'candidate')) {
      const v = r.verdicts[m.key], cur = (models ?? []).find((x: { key: string; version: number }) => x.key === m.key && x.version === m.version) as { status: string; status_reason: string } | undefined;
      if (v && cur && (cur.status !== v.verdict || cur.status_reason !== v.why))
        await supabase.from('research_models').update({ status: v.verdict, status_reason: v.why, status_at: iso(now) }).eq('key', m.key).eq('version', m.version);
    }

    // unexplained movements (the answer columns are never overwritten here)
    const rows = r.episodes.map((e) => ({
      key: e.key, start_at: iso(e.start), end_at: iso(e.end), direction: e.dir, g_from: Math.round(e.g0), g_to: Math.round(e.g1), expected_mgdl: e.expected, resid_mgdl: e.resid,
      iob: e.iob, cob: e.cob, night: e.night, auto_cause: e.autoCause, cause: e.cause, confidence: e.confidence, evidence: e.evidence, info: e.info, updated_at: iso(now),
    }));
    for (let i = 0; i < rows.length; i += 500) await supabase.from('unexplained_events').upsert(rows.slice(i, i + 500), { onConflict: 'key' });

    // questions: expire old ones, then ask only what is worth it (never the same thing twice)
    await supabase.from('research_questions').update({ status: 'expired' }).eq('kind', 'unexplained').eq('status', 'open').lt('created_at', iso(now - 2 * DAY));
    const { data: asked } = await supabase.from('research_questions').select('kind,ref,created_at');
    const seen = new Set((asked ?? []).map((q: { kind: string; ref: string }) => `${q.kind}:${q.ref}`));
    const today = (asked ?? []).filter((q: { created_at: string }) => Date.parse(q.created_at) >= kuwaitDay(now)) as { kind: string }[];
    const cands = [
      ...r.episodes.filter((e) => e.info > 0).map((e) => ({ kind: 'unexplained' as const, ref: e.key, info: e.info })),
      ...r.duplicates.filter((d) => d.moments >= 24).map((d) => ({ kind: 'duplicate' as const, ref: d.id, info: Math.round((d.moments / 36) * 100) / 100 })),
    ].filter((c) => !seen.has(`${c.kind}:${c.ref}`));
    const ask = pickQuestions(cands, today);
    if (ask.length) await supabase.from('research_questions').upsert(ask, { onConflict: 'kind,ref', ignoreDuplicates: true });

    await supabase.from('research_runs').update({
      status: 'done', finished_at: new Date().toISOString(), window_from: iso(r.window.from), window_to: iso(r.window.to), unseen_from: iso(baselineEnd),
      data: r.data, metrics: r.unseen, choices: r.choices, verdicts: r.verdicts, code_version: LAB_CODE_VERSION, error: null,
    }).eq('id', runId);
  } catch (e) {
    await supabase.from('research_runs').update({ status: 'failed', error: String((e as Error).message ?? e).slice(0, 300), finished_at: new Date().toISOString() }).eq('id', runId);
    throw e;
  }
}

let busy = false;
/** Called when the app is open: runs once per 12-hour slot across all phones (the database decides who). */
export async function runLabIfDue(input: RunInput) {
  if (busy) return; busy = true;
  try {
    const now = Date.now();
    const { data: id } = await supabase.rpc('claim_research_run', { p_slot: new Date(slotOf(now)).toISOString() });
    if (id) await execute(id as string, input, now);
  } finally { busy = false; }
}
/** "Run now" on the research page: an extra run outside the schedule. */
export async function runLabNow(input: RunInput) {
  if (busy) return; busy = true;
  try {
    const { data, error } = await supabase.from('research_runs').insert({ trigger: 'manual', status: 'running' }).select('id').single();
    if (error) throw new Error(error.message);
    await execute(data.id, input, Date.now());
  } finally { busy = false; }
}

/** Mounted once in the app: checks on open and every 30 minutes, a few seconds after the screen has settled. */
export function useLabRunner(input: RunInput & { loading: boolean }) {
  const { loading, settings, events, history } = input;
  useEffect(() => {
    if (loading) return;
    const go = () => void runLabIfDue({ settings, events, history }).catch(() => {});
    const first = window.setTimeout(go, 8000), every = window.setInterval(go, 30 * MIN);
    return () => { window.clearTimeout(first); window.clearInterval(every); };
  }, [loading, settings, events, history]);
}

/* -------------------------------------------------------------- questions */

const ANSWER_CAUSE: Partial<Record<AnswerChoice, Cause>> = { food: 'missing_event', insulin: 'missing_event', activity: 'missing_event', illness: 'missing_event', sensor: 'cgm', not_eaten: 'bad_input' };

export async function answerQuestion(q: QuestionRow, choice: string, note: string, me: string | null) {
  const at = new Date().toISOString();
  if (q.kind === 'unexplained') {
    const c = choice as AnswerChoice;
    const patch: Record<string, unknown> = { answer: { choice: c, note: note || undefined }, answered_by: me, answered_at: at };
    if (ANSWER_CAUSE[c]) patch.cause = ANSWER_CAUSE[c];
    const { error } = await supabase.from('unexplained_events').update(patch).eq('key', q.ref);
    if (error) throw new Error(error.message);
  } else if (choice === 'same') await decide(q.ref, 'probable_duplicate');
  else if (choice === 'separate') await decide(q.ref, 'accepted');
  const { error } = await supabase.from('research_questions').update({ status: 'answered', answer: { choice, note: note || undefined }, answered_by: me, answered_at: at }).eq('id', q.id);
  if (error) throw new Error(error.message);
}
export async function skipQuestion(q: QuestionRow) {
  await supabase.from('research_questions').update({ status: 'skipped', answered_at: new Date().toISOString() }).eq('id', q.id);
}

export interface DuplicateInfo { id: string; t: number; sender: string; food_name: string | null; carbs: number | null; reason: string | null; other: { t: number; sender: string } | null }
export interface OpenQuestion { q: QuestionRow; event?: UnexplainedRow; dup?: DuplicateInfo }

/** Open questions with what each is about, most informative first. */
export function useQuestions() {
  const [list, setList] = useState<OpenQuestion[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('research_questions').select('*').eq('status', 'open').order('info', { ascending: false });
    const qs = (data ?? []) as QuestionRow[];
    if (!qs.length) return setList([]);
    const ev = qs.filter((q) => q.kind === 'unexplained').map((q) => q.ref), du = qs.filter((q) => q.kind === 'duplicate').map((q) => q.ref);
    const [{ data: es }, { data: ds }] = await Promise.all([
      ev.length ? supabase.from('unexplained_events').select('*').in('key', ev) : Promise.resolve({ data: [] }),
      du.length ? supabase.from('import_entries').select('id,occurred_at,sender,food_name,carbs,reason,related_key').in('id', du) : Promise.resolve({ data: [] }),
    ]);
    const rel = ((ds ?? []) as { related_key: string | null }[]).map((d) => d.related_key).filter((k): k is string => !!k);
    const { data: others } = rel.length ? await supabase.from('import_entries').select('source_key,occurred_at,sender').in('source_key', rel) : { data: [] };
    const byKey = new Map(((others ?? []) as { source_key: string; occurred_at: string; sender: string }[]).map((o) => [o.source_key, o]));
    setList(qs.map((q) => {
      if (q.kind === 'unexplained') { const e = ((es ?? []) as UnexplainedRow[]).find((x) => x.key === q.ref); return { q, event: e ? fixEvent(e) : undefined }; }
      const d = ((ds ?? []) as { id: string; occurred_at: string; sender: string; food_name: string | null; carbs: number | null; reason: string | null; related_key: string | null }[]).find((x) => x.id === q.ref);
      const o = d?.related_key ? byKey.get(d.related_key) : undefined;
      return { q, dup: d ? { id: d.id, t: Date.parse(d.occurred_at), sender: d.sender, food_name: d.food_name, carbs: d.carbs === null ? null : Number(d.carbs), reason: d.reason, other: o ? { t: Date.parse(o.occurred_at), sender: o.sender } : null } : undefined };
    }).filter((x) => x.event || x.dup));
  }, []);
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 10 * MIN); return () => window.clearInterval(id); }, [load]);
  return { list, reload: load };
}

const fixEvent = (e: UnexplainedRow): UnexplainedRow => ({ ...e, iob: e.iob === null ? null : Number(e.iob), cob: e.cob === null ? null : Number(e.cob), info: Number(e.info) });

/* -------------------------------------------------------------- the page */

export function useLab() {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [events, setEvents] = useState<UnexplainedRow[]>([]);
  const load = useCallback(async () => {
    const [r, m, e] = await Promise.all([
      supabase.from('research_runs').select('*').order('started_at', { ascending: false }).limit(30),
      supabase.from('research_models').select('*').order('created_at'),
      supabase.from('unexplained_events').select('*').gte('start_at', new Date(Date.now() - 14 * DAY).toISOString()).order('start_at', { ascending: false }),
    ]);
    setRuns((r.data ?? []) as RunRow[]); setModels((m.data ?? []) as ModelRow[]); setEvents(((e.data ?? []) as UnexplainedRow[]).map(fixEvent));
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { runs, models, events, reload: load };
}
