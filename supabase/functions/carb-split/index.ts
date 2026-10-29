// Reminds both parents when the later part of a split meal dose is due. Called every minute by the database job
// (pg_cron, with the cron secret from Vault). Kept apart from carb-glucose so the alarms are never touched by it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPush, type Vapid } from './push.ts';
import { splitMessage, splitsDue, type SplitRow } from './split.ts';

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'carb' }, auth: { persistSession: false } });
  const { data: ok } = await db.rpc('cron_secret_matches', { p: req.headers.get('x-cron-secret') ?? '' });
  if (!ok) return new Response('not_allowed', { status: 403 });
  const now = Date.now();
  const { data } = await db.from('planned_meals').select('id,status,name,slot,split_units,split_at,split_done_at,notified')
    .in('status', ['dosed', 'eaten']).is('split_done_at', null).not('split_at', 'is', null)
    .gte('split_at', new Date(now - 40 * 60000).toISOString()).lte('split_at', new Date(now + 60000).toISOString());
  const due = splitsDue((data ?? []) as SplitRow[], now);
  if (!due.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { 'content-type': 'application/json' } });
  const { data: set } = await db.from('settings').select('alert_plan_on').eq('id', true).single();
  if ((set as any)?.alert_plan_on === false) return new Response(JSON.stringify({ sent: 0, off: true }), { headers: { 'content-type': 'application/json' } });
  // the same VAPID key carb-glucose created (it is never created here)
  const cfg = (await db.from('push_config').select('vapid_public,subject').eq('id', true).single()).data as { vapid_public: string | null; subject: string } | null;
  const { data: priv } = await db.rpc('vapid_get');
  if (!cfg?.vapid_public || !priv) return new Response('no_vapid', { status: 500 });
  const v: Vapid = { publicKey: cfg.vapid_public, privateJwk: priv as JsonWebKey, subject: cfg.subject };
  const [{ data: subs }, { data: mem }] = await Promise.all([db.from('push_subscriptions').select('*'), db.from('members').select('user_id,lang')]);
  const langOf = new Map(((mem ?? []) as { user_id: string; lang: string }[]).map((m) => [m.user_id, m.lang === 'en' ? 'en' as const : 'ar' as const]));
  let sent = 0;
  for (const p of due) {
    // claim first, so a second run never sends it again
    const { error } = await db.from('planned_meals').update({ notified: { ...(p.notified ?? {}), split: new Date(Date.parse(p.split_at!)).toISOString() } }).eq('id', p.id);
    if (error) { console.error('split: claim', error.message); continue; }
    for (const s of (subs ?? []) as any[]) {
      const lang = langOf.get(s.user_id) ?? 'ar';
      let status = 0, err = '';
      try { ({ status, error: err } = await sendPush(s, { ...splitMessage(p, lang), tag: `plan-${p.id}`, url: './#/mom', lang }, v, { urgency: 'high', ttl: 900, topic: `split-${p.id}` })); }
      catch (e) { err = e instanceof Error ? e.message : String(e); }
      const good = status >= 200 && status < 300; if (good) sent++;
      if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
      else await db.from('push_subscriptions').update(good ? { last_ok_at: new Date().toISOString(), last_error: null } : { last_error: `${status} ${err}`.trim() }).eq('id', s.id);
      await db.from('notifications').insert({ alert_id: null, subscription_id: status === 404 || status === 410 ? null : s.id, user_id: s.user_id, kind: 'plan_split', status, error: err || null });
    }
  }
  return new Response(JSON.stringify({ sent }), { headers: { 'content-type': 'application/json' } });
});
