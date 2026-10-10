// Live glucose for the kids carb app, display only. Signs in to LibreLinkUp (Abbott's follower
// service, the same route Gluroo uses) with a follower account, stores the readings, and returns
// them. The login is kept in Supabase Vault; the browser can save it but never read it back.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { hostFor, LLU_PRODUCT, LLU_VERSION, LluError, loginProblem, maskEmail, readingsFromGraph, redirectRegion, sensorFrom, sensorReminderDue, sensorToStore, sha256Hex, tooSoon } from './lib.ts';
import { ackMessage, alertMessage, evaluate, lowNow, planMessage, planPushDue, rate15, recipients, sensorMessage, testMessage, treatRecheckMessage, treatRechecksDue, type TreatRow, type AlertCfg, type AlertKind, type Lang, type OpenAlert, type PlanRow } from './alerts.ts';
import { newVapid, sendPush, type Vapid } from './push.ts';

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

async function findPatient(s: Secret, hops = 0): Promise<Secret> {
  const r = await llu(hostFor(s.region), '/llu/connections', { token: s.token, userId: s.userId });
  if (r.http === 429) throw new LluError('rate_limited');
  const moved = redirectRegion(r.json);
  if (moved) {
    // the account lives on a regional server: sign in there and ask again
    if (hops > 1 || moved === s.region) throw new LluError('upstream', 'redirect loop');
    return findPatient(await login({ ...s, region: moved, token: undefined }), hops + 1);
  }
  const first = r.json?.data?.[0];
  if (!first?.patientId) throw new LluError('no_connection');
  return { ...s, patientId: String(first.patientId) };
}

async function graph(s: Secret) {
  const r = await llu(hostFor(s.region), `/llu/connections/${s.patientId}/graph`, { token: s.token, userId: s.userId });
  return r;
}

// ── Web Push ──────────────────────────────────────────────────────────────────
type Db = ReturnType<typeof createClient>;

async function vapid(db: Db): Promise<Vapid> {
  const cfg = (await db.from('push_config').select('*').eq('id', true).single()).data as { vapid_public: string | null; subject: string };
  const { data: priv } = await db.rpc('vapid_get');
  if (priv && cfg.vapid_public) return { publicKey: cfg.vapid_public, privateJwk: priv as JsonWebKey, subject: cfg.subject };
  const v = await newVapid(cfg.subject);
  const { error } = await db.rpc('vapid_put', { p: v.privateJwk });
  if (error) return vapid(db); // another call created it first
  await db.from('push_config').update({ vapid_public: v.publicKey }).eq('id', true);
  return v;
}

type Payload = Record<string, unknown>;
/** Sends to every phone of the family (or only/except one person) and logs each delivery. The payload may depend
 *  on the language of the phone's owner (carb.members.lang). */
async function pushAll(db: Db, payload: Payload | ((lang: Lang) => Payload), o: { kind: string; alertId?: string; urgency: 'normal' | 'high'; only?: string; except?: string; users?: string[] }) {
  let q = db.from('push_subscriptions').select('*');
  if (o.users) { if (!o.users.length) return []; q = q.in('user_id', o.users); }
  if (o.only) q = q.eq('user_id', o.only);
  if (o.except) q = q.neq('user_id', o.except);
  const { data: subs } = await q;
  if (!subs?.length) return [];
  const v = await vapid(db);
  const langs = new Map<string, Lang>();
  if (typeof payload === 'function') {
    const { data: mem } = await db.from('members').select('user_id,lang');
    for (const m of (mem ?? []) as { user_id: string; lang: string }[]) langs.set(m.user_id, m.lang === 'en' ? 'en' : 'ar');
  }
  return Promise.all(subs.map(async (s: any) => {
    let status = 0, error = '';
    const lang: Lang = langs.get(s.user_id) ?? 'ar';
    const body = typeof payload === 'function' ? { ...payload(lang), lang } : payload;
    try { ({ status, error } = await sendPush(s, body, v, { urgency: o.urgency, ttl: o.urgency === 'high' ? 900 : 3600, topic: String(body.tag ?? '') })); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
    const ok = status >= 200 && status < 300;
    if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('id', s.id); // phone unsubscribed
    else await db.from('push_subscriptions').update(ok ? { last_ok_at: new Date().toISOString(), last_error: null } : { last_error: `${status} ${error}`.trim() }).eq('id', s.id);
    await db.from('notifications').insert({ alert_id: o.alertId ?? null, subscription_id: status === 404 || status === 410 ? null : s.id, user_id: s.user_id, kind: o.kind, status, error: error || null });
    return { status, ok };
  }));
}

// ── Alerts: evaluated after every server poll ─────────────────────────────────
/** One push to everyone 24 h and 2 h before the sensor ends; remembered per serial so each goes out once. */
async function sensorReminder(db: Db, now: number) {
  const [{ data: st }, { data: set }] = await Promise.all([
    db.from('cgm_state').select('connected,sensor_sn,sensor_started_at,sensor_reminded').eq('id', true).single(),
    db.from('settings').select('child_name,sensor_days').eq('id', true).single(),
  ]);
  const s = st as any;
  if (!s?.connected || !s.sensor_sn || !s.sensor_started_at) return;
  const days = (set as any)?.sensor_days ?? 14;
  const due = sensorReminderDue(s.sensor_started_at, days, s.sensor_sn, s.sensor_reminded, now);
  if (!due) return;
  await db.from('cgm_state').update({ sensor_reminded: `${s.sensor_sn}:${due}` }).eq('id', true); // claim first: never twice
  const ends = Date.parse(s.sensor_started_at) + days * 86400000;
  await pushAll(db, (lang) => ({ ...sensorMessage(due, ends, lang), tag: 'sensor', url: './#/status' }), { kind: 'sensor', urgency: 'normal' });
}

/** Planned meals: one push to both parents at the check, the eat time and a low's recheck; claimed before sending. */
async function planReminders(db: Db, now: number) {
  const { data } = await db.from('planned_meals').select('id,status,name,slot,dose_at,eat_after_min,remind_min,recheck_at,notified,eating_at')
    .in('status', ['planned', 'dosed', 'eaten']).gte('dose_at', new Date(now - 9 * 3600000).toISOString()).lte('dose_at', new Date(now + 6 * 3600000).toISOString());
  if (!data?.length) return;
  const [{ data: set }, { data: last }] = await Promise.all([
    db.from('settings').select('glucose_unit,iob_dia_min,plan_review_rules').eq('id', true).single(),
    db.from('glucose_readings').select('taken_at,mg_dl,trend').order('taken_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const r = last as { taken_at: string; mg_dl: number; trend: number | null } | null;
  const g = r && now - Date.parse(r.taken_at) <= 15 * 60000 ? { mg: r.mg_dl, trend: r.trend, unit: ((set as any)?.glucose_unit === 'mmol' ? 'mmol' : 'mgdl') as 'mmol' | 'mgdl' } : null;
  const rv = { earlyMin: Number((set as any)?.plan_review_rules?.early_min) || 120, diaMin: Number((set as any)?.iob_dia_min) || 360 };
  for (const p of data as (PlanRow & { id: string })[]) {
    const due = planPushDue(p, now, rv);
    if (!due) continue;
    const { error } = await db.from('planned_meals').update({ notified: { ...(p.notified ?? {}), [due.kind]: due.at } }).eq('id', p.id); // claim first: never twice
    if (error) { console.error('plans: claim', error.message); continue; }
    await pushAll(db, (lang) => ({ ...planMessage(due.kind, p, lang, g), tag: `plan-${p.id}`, url: due.kind === 'early' || due.kind === 'final' ? `./#/plans/${p.id}` : `./#/?plan=${p.id}` }), { kind: `plan_${due.kind}`, urgency: due.kind === 'early' || due.kind === 'final' ? 'normal' : 'high' });
  }
}

/** After every logged low treatment: one "check again" push to both parents; claimed before sending. */
async function treatRechecks(db: Db, now: number) {
  const since = new Date(now - 60 * 60000).toISOString();
  const [{ data: rows }, { data: plans }, { data: set }, { data: last }] = await Promise.all([
    db.from('events').select('id,occurred_at,recheck_sent_at').eq('kind', 'treatment').is('deleted_at', null).gte('occurred_at', since),
    db.from('planned_meals').select('treatment_event_id').not('treatment_event_id', 'is', null).gte('dose_at', new Date(now - 12 * 3600000).toISOString()),
    db.from('settings').select('glucose_unit,treat_recheck_min').eq('id', true).single(),
    db.from('glucose_readings').select('taken_at,mg_dl,trend').order('taken_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!rows?.length) return;
  const min = Number((set as any)?.treat_recheck_min) || 15;
  const due = treatRechecksDue(rows as TreatRow[], now, min, new Set((plans ?? []).map((p: any) => p.treatment_event_id)));
  const r = last as { taken_at: string; mg_dl: number; trend: number | null } | null;
  const g = r && now - Date.parse(r.taken_at) <= 15 * 60000 ? { mg: r.mg_dl, trend: r.trend, unit: ((set as any)?.glucose_unit === 'mmol' ? 'mmol' : 'mgdl') as 'mmol' | 'mgdl' } : null;
  for (const t of due) {
    const { data: claimed } = await db.from('events').update({ recheck_sent_at: new Date(now).toISOString() }).eq('id', t.id).is('recheck_sent_at', null).select('id');
    if (!claimed?.length) continue; // another run sent it
    await pushAll(db, (lang) => ({ ...treatRecheckMessage(lang, g, min), tag: `recheck-${t.id}`, url: './#/' }), { kind: 'treat_recheck', urgency: 'high' });
  }
}

async function runAlerts(db: Db, now: number) {
  const [st, set, last, open, mem] = await Promise.all([
    db.from('cgm_state').select('connected').eq('id', true).single(),
    db.from('settings').select('*').eq('id', true).single(),
    db.from('glucose_readings').select('taken_at,mg_dl,trend').gte('taken_at', new Date(now - 25 * 60000).toISOString()).order('taken_at'),
    db.from('alerts').select('*').neq('state', 'resolved'),
    db.from('members').select('user_id,alert_role'),
  ]);
  const s: any = set.data;
  if (!s) { console.error('alerts: settings', set.error?.message); return; }
  let readings = (last.data ?? []) as any[];
  if (!readings.length) { // nothing in 25 min: the newest reading still decides "no data" and its age
    const { data } = await db.from('glucose_readings').select('taken_at,mg_dl,trend').order('taken_at', { ascending: false }).limit(1);
    readings = (data ?? []) as any[];
  }
  const latest = readings[readings.length - 1] ?? null;
  const cfg: AlertCfg = { urgentLow: s.alert_urgent_low_mgdl, low: s.alert_low_mgdl, high: s.alert_high_mgdl, lowDelay: s.alert_low_delay_min,
    highDelay: s.alert_high_delay_min, noDataMin: s.alert_nodata_min, renotify: s.alert_renotify_min, highRenotify: s.alert_high_renotify_min,
    rapidRate: s.alert_rapid_rate === null ? null : Number(s.alert_rapid_rate), escalateMin: s.escalate_min,
    fallRate: s.alert_fall_rate == null ? null : Number(s.alert_fall_rate), riseRate: s.alert_rise_rate == null ? null : Number(s.alert_rise_rate),
    predictLowMin: s.alert_predict_low_min ?? null,
    night: s.night_start && s.night_end ? { start: s.night_start, end: s.night_end, low: s.night_low_mgdl, high: s.night_high_mgdl, highSilent: s.night_high_silent } : null,
    school: s.school_start && s.school_end ? { days: s.school_days ?? [], start: s.school_start, end: s.school_end, low: s.school_low_mgdl, high: s.school_high_mgdl } : null };
  const members = (mem.data ?? []) as { user_id: string; alert_role: string }[];
  const openRows = (open.data ?? []) as (OpenAlert & Record<string, unknown>)[];
  const steps = evaluate(now, readings, cfg, openRows, Boolean((st.data as any)?.connected));
  for (const step of steps) {
    let id = step.id, startedAt = openRows.find((a) => a.id === id)?.started_at ?? new Date(now).toISOString();
    if (step.op === 'create') {
      const { data, error } = await db.from('alerts').insert({ kind: step.kind, ...step.patch }).select('id,started_at').single();
      if (error) { if (error.code !== '23505') console.error('alerts: insert', error.message); continue; } // 23505: another run created it
      id = (data as any).id; startedAt = (data as any).started_at;
    } else if (step.op === 'delete') { await db.from('alerts').delete().eq('id', id!); continue; }
    else if (step.op === 'resolve') await db.from('alerts').update({ state: 'resolved', ...step.patch }).eq('id', id!);
    else await db.from('alerts').update(step.patch).eq('id', id!);
    if (!step.notify || step.silent) continue;
    const minutes = step.kind === 'no_data'
      ? (latest ? (now - Date.parse(latest.taken_at)) / 60000 : 0)
      : (now - Date.parse(startedAt)) / 60000;
    const value = step.kind === 'no_data' ? null : (latest?.mg_dl ?? null);
    const fresh = latest && now - Date.parse(latest.taken_at) <= 15 * 60000;
    const msg = (lang: Lang) => alertMessage(step.kind, step.notify!, { value, trend: latest?.trend ?? null, unit: s.glucose_unit === 'mmol' ? 'mmol' : 'mgdl', minutes,
      low: lowNow(now, cfg), rate: fresh ? rate15(readings) : null, ahead: s.alert_predict_low_min == null ? null : Math.max(s.alert_predict_low_min, 30) }, lang);
    await pushAll(db, (lang) => { const m = msg(lang); return { title: m.title, body: m.body, tag: `alert-${step.kind}`, url: './#/', kind: step.kind, sticky: m.severity === 'urgent' }; },
      { kind: step.notify, alertId: id, urgency: msg('ar').urgency, users: recipients(members, step.notify) });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'carb' }, auth: { persistSession: false } });

  // Two callers: a family member from the app, or the every-minute database job (pg_cron), which proves
  // itself with a secret that lives only in Vault. The job may only "read"; nothing else.
  const cronSecret = req.headers.get('x-cron-secret');
  let fromCron = false;
  let userId: string | null = null;
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
    userId = (await asUser.auth.getUser()).data.user?.id ?? null;
  }

  const body = await req.json().catch(() => ({}));
  if (fromCron && body.action !== 'debug') body.action = 'read';
  const now = Date.now();
  if (fromCron) await db.from('cgm_state').update({ last_cron_at: new Date(now).toISOString() }).eq('id', true);

  const recent = async () => {
    const since = new Date(now - 3 * 3600 * 1000).toISOString();
    const { data } = await db.from('glucose_readings').select('taken_at,mg_dl,trend').gte('taken_at', since).order('taken_at');
    return data ?? [];
  };
  const state = async () => (await db.from('cgm_state').select('*').eq('id', true).single()).data;
  const reply = async (extra: Record<string, unknown> = {}) => {
    if (fromCron) {
      try { await runAlerts(db, Date.now()); } catch (e) { console.error('alerts', e instanceof Error ? e.message : e); }
      try { await sensorReminder(db, Date.now()); } catch (e) { console.error('sensor', e instanceof Error ? e.message : e); }
      try { await planReminders(db, Date.now()); } catch (e) { console.error('plans', e instanceof Error ? e.message : e); }
      try { await treatRechecks(db, Date.now()); } catch (e) { console.error('rechecks', e instanceof Error ? e.message : e); }
      return json({ ok: !extra.error, ...extra });
    }
    const st = await state();
    const readings = await recent();
    return json({ connected: Boolean(st?.connected), account_hint: st?.account_hint ?? null, last_ok_at: st?.last_ok_at ?? null,
      last_error: st?.last_error ?? null, latest: readings.at(-1) ?? null, readings,
      sensor: st?.sensor_started_at ? { sn: st.sensor_sn, started_at: st.sensor_started_at } : null, ...extra });
  };
  const fail = async (e: unknown) => {
    const code = e instanceof LluError ? e.code : 'upstream';
    await db.from('cgm_state').update({ last_error: code, updated_at: new Date().toISOString() }).eq('id', true);
    return reply({ error: code });
  };

  try {
    if (body.action === 'status') return await reply();

    // ── alerts and push, for family members ──
    if (body.action === 'push_key') return json({ publicKey: (await vapid(db)).publicKey });
    if (body.action === 'test_push' && userId) {
      const sent = await pushAll(db, (lang) => ({ ...testMessage(lang), tag: 'test', url: './#/' }), { kind: 'test', urgency: 'high', only: userId });
      return json({ sent: sent.length, ok: sent.filter((r) => r.ok).length });
    }
    if (body.action === 'ack' && userId) {
      const act = body.ack === 'treated' ? 'treated' : 'on_it';
      const { data: a } = await db.from('alerts').select('*').eq('id', String(body.id ?? '')).in('state', ['active', 'acknowledged']).maybeSingle();
      if (!a) return json({ error: 'not_open' }, 404);
      const max = (a as any).kind === 'urgent_low' ? 15 : 60;
      const mins = Math.min(max, Math.max(5, Number(body.snooze_min) || 15));
      await db.from('alerts').update({ state: 'acknowledged', acknowledged_by: userId, acknowledged_at: new Date().toISOString(), ack_action: act,
        snoozed_until: new Date(Date.now() + mins * 60000).toISOString() }).eq('id', (a as any).id);
      const { data: me } = await db.from('members').select('display_name').eq('user_id', userId).maybeSingle();
      const ack = (lang: Lang) => ackMessage((a as any).kind as AlertKind, (me as any)?.display_name || null, act, lang);
      await pushAll(db, (lang) => ({ title: ack(lang).title, body: ack(lang).body, tag: `alert-${(a as any).kind}`, url: './#/' }), { kind: 'ack', alertId: (a as any).id, urgency: 'normal', except: userId });
      return json({ ok: true, snoozed_min: mins });
    }

    // Diagnostic for the database job only: what Abbott returns, timestamps and counts, no credentials.
    if (fromCron && body.action === 'debug') {
      const { data: secret } = await db.rpc('cgm_secret_get');
      let s = secret as Secret | null;
      if (!s) return json({ error: 'no_connection' });
      if (!s.token || !s.userId || !s.patientId) s = await findPatient(await login(s));
      const pick = (m: any) => m && { ts: m.Timestamp, fts: m.FactoryTimestamp, mg: m.ValueInMgPerDl, arrow: m.TrendArrow };
      const g = await graph(s);
      const c = await llu(hostFor(s.region), '/llu/connections', { token: s.token, userId: s.userId });
      const gd = g.json?.data?.graphData ?? [];
      return json({
        graph_http: g.http, graph_current: pick(g.json?.data?.connection?.glucoseMeasurement), graph_item: pick(g.json?.data?.connection?.glucoseItem),
        graph_len: gd.length, graph_last: gd.slice(-3).map(pick),
        conn_http: c.http, conn_current: pick(c.json?.data?.[0]?.glucoseMeasurement), conn_item: pick(c.json?.data?.[0]?.glucoseItem),
        sensor: c.json?.data?.[0]?.sensor ? { a: c.json.data[0].sensor.a, pt: c.json.data[0].sensor.pt } : null,
        token_exp: s.tokenExp ?? null, region: s.region ?? null,
        graph_raw: { status: g.json?.status, keys: g.json ? Object.keys(g.json) : null, data_keys: g.json?.data && typeof g.json.data === 'object' ? Object.keys(g.json.data) : null, msg: g.json?.message ?? g.json?.error ?? null },
        conn_raw: { status: c.json?.status, keys: c.json ? Object.keys(c.json) : null, data_len: Array.isArray(c.json?.data) ? c.json.data.length : typeof c.json?.data, msg: c.json?.message ?? c.json?.error ?? null, ticket: Boolean(c.json?.ticket) },
      });
    }

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
        const moved = redirectRegion(r.json);
        if (moved) { // regional server: sign in there once and retry
          s = await findPatient(await login({ ...s, region: moved, token: undefined }));
          await db.rpc('cgm_secret_put', { p: s });
          r = await graph(s);
        }
        if (r.http === 429) throw new LluError('rate_limited');
        if (r.http >= 400) throw new LluError('upstream', `graph http ${r.http}`);
        const readings = readingsFromGraph(r.json?.data);
        // a 200 with nothing in it is not success: say so instead of pretending all is well
        if (!readings.length) throw new LluError('no_data', 'graph returned no readings');
        if (readings.length) await db.from('glucose_readings').upsert(readings, { onConflict: 'taken_at' });
        // the sensor she wears now; never back to an older one if LibreLinkUp's reply lags behind a change
        const sensor = sensorToStore(sensorFrom(r.json?.data, now), st.sensor_started_at);
        await db.from('cgm_state').update({ last_ok_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString(),
          ...(sensor ? { sensor_sn: sensor.sn, sensor_started_at: sensor.started_at } : {}) }).eq('id', true);
        return await reply();
      } catch (e) { return await fail(e); }
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error('carb-glucose', e instanceof Error ? e.message : e);
    return json({ error: 'server' }, 500);
  }
});
