// Family accounts (More › Accounts): list, add, change and remove the parents who use Layan's app. Only a family member
// can call it, and only accounts in the family can be changed. The sign-in system is shared with the shift app
// (Timekeeper), so removing someone only takes them out of Layan's family: their sign-in account is never deleted, and
// an existing account added by email keeps its own password.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const db = admin.schema('carb');
  // who is asking: a signed-in family member
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const me = (await asUser.auth.getUser()).data.user;
  if (!me) return json({ error: 'not_signed_in' }, 401);
  const { data: mine } = await db.from('members').select('user_id').eq('user_id', me.id).maybeSingle();
  if (!mine) return json({ error: 'not_allowed' }, 403);

  const body = await req.json().catch(() => ({}));
  const inFamily = async (id: string) => !!(await db.from('members').select('user_id').eq('user_id', id).maybeSingle()).data;
  const findByEmail = async (email: string) => {
    for (let page = 1; page < 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(error.message);
      const u = data.users.find((x) => (x.email ?? '').toLowerCase() === email);
      if (u || data.users.length < 1000) return u ?? null;
    }
    return null;
  };

  try {
    if (body.action === 'list') {
      const { data: ms } = await db.from('members').select('user_id,display_name,created_at,simple_mode').order('created_at');
      const out = [];
      for (const m of ms ?? []) {
        const { data } = await admin.auth.admin.getUserById(m.user_id);
        out.push({ ...m, email: data.user?.email ?? null, last_sign_in_at: data.user?.last_sign_in_at ?? null, shared: /\.local$/i.test(data.user?.email ?? '') });
      }
      return json({ members: out, me: me.id });
    }

    if (body.action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase(), name = String(body.name ?? '').trim() || null, password = String(body.password ?? '');
      if (!EMAIL.test(email)) return json({ error: 'bad_email' }, 400);
      let user = await findByEmail(email), existing = !!user;
      if (!user) {
        if (password.length < 8) return json({ error: 'short_password' }, 400);
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) return json({ error: 'create_failed', detail: error.message }, 400);
        user = data.user;
      }
      const { error } = await db.from('members').upsert({ user_id: user!.id, display_name: name, alert_role: 'off' }, { onConflict: 'user_id', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      if (name) await db.from('members').update({ display_name: name }).eq('user_id', user!.id);
      return json({ ok: true, existing });
    }

    if (body.action === 'update') {
      const id = String(body.user_id ?? '');
      if (!(await inFamily(id))) return json({ error: 'not_in_family' }, 404);
      if (typeof body.name === 'string') {
        const { error } = await db.from('members').update({ display_name: body.name.trim() || null }).eq('user_id', id);
        if (error) throw new Error(error.message);
      }
      const patch: { email?: string; password?: string; email_confirm?: boolean } = {};
      if (typeof body.email === 'string' && body.email.trim()) {
        const email = body.email.trim().toLowerCase();
        if (!EMAIL.test(email)) return json({ error: 'bad_email' }, 400);
        const cur = (await admin.auth.admin.getUserById(id)).data.user;
        if (/\.local$/i.test(cur?.email ?? '')) return json({ error: 'shared_account' }, 400); // the shift app's username
        if (email !== cur?.email) { const other = await findByEmail(email); if (other) return json({ error: 'email_taken' }, 400); patch.email = email; patch.email_confirm = true; }
      }
      if (typeof body.password === 'string' && body.password) {
        if (body.password.length < 8) return json({ error: 'short_password' }, 400);
        patch.password = body.password;
      }
      if (patch.email || patch.password) {
        const { error } = await admin.auth.admin.updateUserById(id, patch);
        if (error) return json({ error: 'update_failed', detail: error.message }, 400);
      }
      return json({ ok: true });
    }

    if (body.action === 'remove') {
      const id = String(body.user_id ?? '');
      if (id === me.id) return json({ error: 'not_yourself' }, 400);
      if (!(await inFamily(id))) return json({ error: 'not_in_family' }, 404);
      // their entries stay (they keep their name in the log); only their place in the family goes
      const { error } = await db.from('members').delete().eq('user_id', id);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e); console.error('carb-admin', m); return json({ error: 'server', detail: m }, 500);
  }
});
