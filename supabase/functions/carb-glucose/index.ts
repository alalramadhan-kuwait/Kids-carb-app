// Live glucose for the kids carb app, display only. Signs in to LibreLinkUp (Abbott's follower
// service, the same route Gluroo uses) with a follower account, stores the readings, and returns
// them. The login is kept in Supabase Vault; the browser can save it but never read it back.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { hostFor, LLU_PRODUCT, LLU_VERSION, LluError, loginProblem, maskEmail, readingsFromGraph, sha256Hex, tooSoon } from './lib.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

interface Secret { email: string; password: string; token?: string; tokenExp?: number; userId?: string; region?: string | null; patientId?: string }

async function llu(host: string, path: string, o: { token?: string; userId?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json', accept: 'application/json', 'cache-control': 'no-cache',
    product: LLU_PRODUCT, version: LLU_VERSION,
  };
  if (o.token && o.userId) {
    headers.authorization = `Bearer ${o.token}`;
    headers['account-id'] = await sha256Hex(o.userId); // required on every authenticated call since Oct 2025
  }
  const res = await fetch(host + path, { method: o.method ?? 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined });
  let j: any = null;
  try { j = await res.json(); } catch { /* not json */ }
  return { http: res.status, json: j };
}

async function login(s: Secret): Promise<Secret> {
  let region = s.region ?? null;
  for (let hop = 0; hop < 3; hop++) {
    const r = await llu(hostFor(region), '/llu/auth/login', { method: 'POST', body: { email: s.email, password: s.password } });
    const problem = loginProblem(r.http, r.json);
    if (problem) throw new LluError(problem, `login http ${r.http}`);
    if (r.json?.data?.redirect && r.json?.data?.region) { region = String(r.json.data.region); continue; }
    const token = r.json?.data?.authTicket?.token, userId = r.json?.data?.user?.id;
    if (!token || !userId) throw new LluError('upstream', 'login without token');
    return { ...s, token, userId, region, tokenExp: Number(r.json.data.authTicket.expires) || undefined };
  }
  throw new LluError('upstream', 'too many redirects');
}

async function findPatient(s: Secret): Promise<Secret> {
  const r = await llu(hostFor(s.region), '/llu/connections', { token: s.token, userId: s.userId });
  if (r.http === 429) throw new LluError('rate_limited');
  const first = r.json?.data?.[0];
  if (!first?.patientId) throw new LluError('no_connection');
  return { ...s, patientId: String(first.patientId) };
}

async function graph(s: Secret) {
  const r = await llu(hostFor(s.region), `/llu/connections/${s.patientId}/graph`, { token: s.token, userId: s.userId });
  return r;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'carb' }, auth: { persistSession: false } });

  // Two callers: a family member from the app, or the every-minute database job (pg_cron), which proves
  // itself with a secret that lives only in Vault. The job may only "read"; nothing else.
  const cronSecret = req.headers.get('x-cron-secret');
  let fromCron = false;
  if (cronSecret) {
    const { data: ok } = await db.rpc('cron_secret_matches', { p: cronSecret });
    if (!ok) return json({ error: 'not_allowed' }, 403);
    fromCron = true;
  } else {
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, db: { schema: 'carb' }, auth: { persistSession: false },
    });
    const { data: member } = await asUser.rpc('is_member');
    if (!member) return json({ error: 'not_allowed' }, 403);
  }

  const body = await req.json().catch(() => ({}));
  if (fromCron) body.action = 'read';
  const now = Date.now();
  if (fromCron) await db.from('cgm_state').update({ last_cron_at: new Date(now).toISOString() }).eq('id', true);

  const recent = async () => {
    const since = new Date(now - 3 * 3600 * 1000).toISOString();
    const { data } = await db.from('glucose_readings').select('taken_at,mg_dl,trend').gte('taken_at', since).order('taken_at');
    return data ?? [];
  };
  const state = async () => (await db.from('cgm_state').select('*').eq('id', true).single()).data;
  const reply = async (extra: Record<string, unknown> = {}) => {
    if (fromCron) return json({ ok: !extra.error, ...extra });
    const st = await state();
    const readings = await recent();
    return json({ connected: Boolean(st?.connected), account_hint: st?.account_hint ?? null, last_ok_at: st?.last_ok_at ?? null,
      last_error: st?.last_error ?? null, latest: readings.at(-1) ?? null, readings, ...extra });
  };
  const fail = async (e: unknown) => {
    const code = e instanceof LluError ? e.code : 'upstream';
    await db.from('cgm_state').update({ last_error: code, updated_at: new Date().toISOString() }).eq('id', true);
    return reply({ error: code });
  };

  try {
    if (body.action === 'status') return await reply();

    if (body.action === 'clear') {
      await db.rpc('cgm_secret_clear');
      await db.from('cgm_state').update({ connected: false, account_hint: null, last_error: null, updated_at: new Date().toISOString() }).eq('id', true);
      return await reply();
    }

    if (body.action === 'save') {
      const email = String(body.email ?? '').trim(), password = String(body.password ?? '');
      if (!email.includes('@') || !password) return json({ error: 'bad_input' }, 400);
      try {
        // prove the login works, and find the child, before keeping anything
        let s = await login({ email, password });
        s = await findPatient(s);
        await db.rpc('cgm_secret_put', { p: s });
        await db.from('cgm_state').update({ connected: true, account_hint: maskEmail(email), last_fetch_at: null, last_error: null, updated_at: new Date().toISOString() }).eq('id', true);
      } catch (e) { return await fail(e); }
      body.action = 'read';
    }

    if (body.action === 'read') {
      const st = await state();
      if (!st?.connected) return await reply();
      if (tooSoon(st.last_fetch_at, now)) return await reply();
      await db.from('cgm_state').update({ last_fetch_at: new Date(now).toISOString() }).eq('id', true); // claim the slot first
      const { data: secret } = await db.rpc('cgm_secret_get');
      let s = secret as Secret | null;
      if (!s) return await reply({ error: 'no_connection' });
      try {
        if (!s.token || !s.userId || !s.patientId) { s = await findPatient(await login(s)); await db.rpc('cgm_secret_put', { p: s }); }
        let r = await graph(s);
        if (r.http === 401 || r.http === 403) { // session expired: sign in again once
          s = await findPatient(await login(s));
          await db.rpc('cgm_secret_put', { p: s });
          r = await graph(s);
        }
        if (r.http === 429) throw new LluError('rate_limited');
        if (r.http >= 400) throw new LluError('upstream', `graph http ${r.http}`);
        const readings = readingsFromGraph(r.json?.data);
        if (readings.length) await db.from('glucose_readings').upsert(readings, { onConflict: 'taken_at' });
        await db.from('cgm_state').update({ last_ok_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('id', true);
        return await reply();
      } catch (e) { return await fail(e); }
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error('carb-glucose', e instanceof Error ? e.message : e);
    return json({ error: 'server' }, 500);
  }
});
