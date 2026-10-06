// Shared activity pushes for the kids carb app. A database trigger queues every manual entry that shows on Layan's
// graph (carb.activity_feed) and calls this function at once; a once-a-minute job calls it too for anything left.
// Only those two callers, both proven by the cron secret in Vault. push.ts is a copy of carb-glucose's.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { activityMessage, activityRecipients, type ActivityMember, type ActivityRow, type Lang } from './activity.ts';
import { sendPush, type Vapid } from './push.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Db = ReturnType<typeof createClient>;
type Row = ActivityRow & { id: string; ref_table: string; ref_id: string; created_at: string };

/** The family's push key, created by carb-glucose the first time a phone turned notifications on. */
async function vapid(db: Db): Promise<Vapid | null> {
  const cfg = (await db.from('push_config').select('vapid_public,subject').eq('id', true).single()).data as { vapid_public: string | null; subject: string } | null;
  const { data: priv } = await db.rpc('vapid_get');
  return priv && cfg?.vapid_public ? { publicKey: cfg.vapid_public, privateJwk: priv as JsonWebKey, subject: cfg.subject } : null;
}

async function send(db: Db, v: Vapid, a: Row, users: string[], payload: (lang: Lang) => Record<string, unknown>, langs: Map<string, Lang>) {
  const { data: subs } = await db.from('push_subscriptions').select('*').in('user_id', users);
  const urgency = a.kind === 'rapid' || a.kind === 'long' ? 'high' as const : 'normal' as const;
  await Promise.all((subs ?? []).map(async (s: any) => {
    const lang = langs.get(s.user_id) ?? 'ar';
    let status = 0, error = '';
    try { ({ status, error } = await sendPush(s, { ...payload(lang), lang }, v, { urgency, ttl: 1800, topic: `activity-${a.kind}` })); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
    const ok = status >= 200 && status < 300, gone = status === 404 || status === 410;
    if (gone) await db.from('push_subscriptions').delete().eq('id', s.id); // phone unsubscribed
    else await db.from('push_subscriptions').update(ok ? { last_ok_at: new Date().toISOString(), last_error: null } : { last_error: `${status} ${error}`.trim() }).eq('id', s.id);
    await db.from('notifications').insert({ subscription_id: gone ? null : s.id, user_id: s.user_id, kind: `activity_${a.kind}`, status, error: error || null });
  }));
}

async function run(db: Db, now: number) {
  // a failed read is an error, never "nothing to send" (a missing grant once hid every push that way)
  const { data, error } = await db.from('activity_feed').select('*').is('sent_at', null).order('created_at').limit(20);
  if (error) throw new Error(`activity_feed: ${error.message}`);
  if (!data?.length) return 0;
  const [{ data: mem }, { data: set }, v] = await Promise.all([
    db.from('members').select('user_id,display_name,activity_push,lang'),
    db.from('settings').select('glucose_unit').eq('id', true).single(),
    vapid(db),
  ]);
  const members = (mem ?? []) as (ActivityMember & { lang: string })[];
  const langs = new Map<string, Lang>(members.map((m) => [m.user_id, m.lang === 'en' ? 'en' : 'ar']));
  const unit = (set as any)?.glucose_unit === 'mmol' ? 'mmol' as const : 'mgdl' as const;
  let sent = 0;
  for (const a of data as Row[]) {
    const { data: claimed, error: claimErr } = await db.from('activity_feed').update({ sent_at: new Date(now).toISOString() }).eq('id', a.id).is('sent_at', null).select('id');
    if (claimErr) throw new Error(`claim: ${claimErr.message}`);
    if (!claimed?.length) continue; // another call sent it
    if (!v || now - Date.parse(a.created_at) > 15 * 60000) continue; // no push key yet, or queued too long ago to be news
    const ref = a.ref_table === 'events'
      ? (await db.from('events').select('id,deleted_at').eq('id', a.ref_id).maybeSingle()).data as { deleted_at: string | null } | null
      : (await db.from('meal_history').select('id').eq('id', a.ref_id).maybeSingle()).data as { deleted_at?: null } | null;
    if (!ref || ref.deleted_at) continue; // removed again as a mistake
    const users = activityRecipients(members, a.by_user, a.kind);
    if (!users.length) continue;
    const who = members.find((m) => m.user_id === a.by_user)?.display_name?.trim() || null;
    await send(db, v, a, users, (lang) => ({ ...activityMessage(a, who, lang, unit), tag: `activity-${a.id}`, url: `./#/?at=${Date.parse(a.occurred_at)}` }), langs);
    sent++;
  }
  return sent;
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'carb' }, auth: { persistSession: false } });
  const { data: ok } = await db.rpc('cron_secret_matches', { p: req.headers.get('x-cron-secret') ?? '' });
  if (!ok) return json({ error: 'not_allowed' }, 403);
  try { return json({ ok: true, sent: await run(db, Date.now()) }); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); console.error('carb-activity', m); return json({ error: 'server', detail: m }, 500); }
});
