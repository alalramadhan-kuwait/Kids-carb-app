// The forecast benchmark and shadow forecasts (master plan §6, Stage 3). Called only by two scheduled jobs that prove
// the cron secret in Vault: «shadow» every 15 minutes stores each candidate's forecast for now (kept, never shown), and
// «benchmark» once a day scores every candidate on all her data with the last 7 days held out. Only forecasts and
// summary numbers are written; nothing is sent anywhere, and nothing here touches doses, alerts or the app's screens.
// The maths is the app's own (bench.js is bundled from src/engine by scripts/bundle-benchmark.mjs).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { benchmark, BENCH_VERSION, isDrink, shadowNow } from './bench.js';

type BData = Parameters<typeof benchmark>[0]; // the shapes are src/engine/benchmark.ts's

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Db = ReturnType<typeof createClient>;
const H = 3600000;

/** Every row (PostgREST pages at 1000). */
async function all<T>(q: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** Her data since `since`, each entry with the moment it became known (created_at), so no forecast uses the future. */
async function load(db: Db, since: number): Promise<BData> {
  const iso = new Date(since).toISOString(), food0 = new Date(since - 12 * H).toISOString();
  const [rd, ev, ml, ph] = await Promise.all([
    all<any>(() => db.from('glucose_readings').select('taken_at,mg_dl,trend').gte('taken_at', iso).order('taken_at')),
    all<any>(() => db.from('events').select('kind,occurred_at,created_at,insulin_units,insulin_type,carbs_g').is('deleted_at', null).in('kind', ['insulin', 'carbs', 'treatment']).gte('occurred_at', food0)),
    all<any>(() => db.from('meal_history').select('name,kind,eaten_at,created_at,total_carbs,total_fat,intake,carbs_unknown').is('deleted_at', null).gte('eaten_at', food0)),
    all<any>(() => db.from('param_history').select('effective_from,dia,peak,absorb,ratios').order('effective_from')),
  ]);
  const t = (s: string) => Date.parse(s);
  return {
    readings: rd.map((r) => ({ t: t(r.taken_at), v: Number(r.mg_dl), trend: r.trend ?? null })),
    doses: ev.filter((e) => e.kind === 'insulin' && e.insulin_type === 'rapid' && e.insulin_units).map((e) => ({ t: t(e.occurred_at), known: t(e.created_at), units: Number(e.insulin_units) })),
    foods: [
      ...ml.filter((m) => m.total_carbs !== null && !m.carbs_unknown && m.intake !== 'pending')
        .map((m) => ({ t: t(m.eaten_at), known: t(m.created_at), carbs: Number(m.total_carbs), fat: m.total_fat, drink: isDrink(m.name), meal: m.kind !== 'treatment' && !isDrink(m.name) })),
      ...ev.filter((e) => (e.kind === 'carbs' || e.kind === 'treatment') && e.carbs_g)
        .map((e) => ({ t: t(e.occurred_at), known: t(e.created_at), carbs: Number(e.carbs_g), drink: e.kind === 'treatment', meal: e.kind === 'carbs' })),
    ],
    params: ph.filter((p) => p.dia && p.peak && p.absorb && p.ratios?.[0]?.cr && p.ratios?.[0]?.isf)
      .map((p) => ({ from: t(p.effective_from), dia: p.dia, peak: p.peak, absorb: p.absorb, cr: Number(p.ratios[0].cr), isf: Number(p.ratios[0].isf) })),
  };
}

async function shadow(db: Db, now: number) {
  const d = await load(db, now - 6 * H);
  const { data: last } = await db.from('benchmark_runs').select('result').order('created_at', { ascending: false }).limit(1);
  const rows = shadowNow(d, now, (last?.[0] as any)?.result?.bands ?? {}).map((r: any) => ({ ...r, bench_version: BENCH_VERSION }));
  if (rows.length) { const { error } = await db.from('forecast_shadow').upsert(rows, { onConflict: 'model,origin,horizon_min', ignoreDuplicates: true }); if (error) throw new Error(error.message); }
  return { stored: rows.length };
}

async function bench(db: Db) {
  const { data: first } = await db.from('glucose_readings').select('taken_at').order('taken_at').limit(1);
  const d = await load(db, first?.[0] ? Date.parse((first[0] as any).taken_at) : Date.now() - 30 * 24 * H);
  const res = benchmark(d);
  if (!res) return { ran: false };
  const { error } = await db.from('benchmark_runs').insert({ bench_version: BENCH_VERSION, data_from: new Date(res.from).toISOString(), data_to: new Date(res.to).toISOString(), test_from: new Date(res.testFrom).toISOString(), result: res });
  if (error) throw new Error(error.message);
  return { ran: true, test_from: new Date(res.testFrom).toISOString() };
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'carb' }, auth: { persistSession: false } });
  const { data: ok } = await db.rpc('cron_secret_matches', { p: req.headers.get('x-cron-secret') ?? '' });
  if (!ok) return json({ error: 'not_allowed' }, 403);
  const { action } = await req.json().catch(() => ({ action: 'shadow' }));
  try { return json(action === 'benchmark' ? await bench(db) : await shadow(db, Date.now())); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); console.error('carb-benchmark', m); return json({ error: 'server', detail: m }, 500); }
});
