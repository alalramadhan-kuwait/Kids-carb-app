// Food photo estimates for the kids carb app: a family member sends a photo (and an optional note); Claude returns
// the foods it sees with estimated weights and nutrients. Display only: the app shows the estimate for the parents
// to check and edit, and nothing is saved until they do. The Anthropic key lives in Vault (carb.ai_secret_*).
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { DAILY_LIMIT, MODEL, SCHEMA, SYSTEM, cleanEstimate, mentionsDosing } from './estimate.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const MEDIA = ['image/jpeg', 'image/png', 'image/webp'] as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'carb' }, auth: { persistSession: false } });
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, db: { schema: 'carb' }, auth: { persistSession: false },
  });
  const { data: member } = await asUser.rpc('is_member');
  if (!member) return json({ error: 'not_allowed' }, 403);
  const userId = (await asUser.auth.getUser()).data.user?.id;
  if (!userId) return json({ error: 'not_allowed' }, 403);

  const body = await req.json().catch(() => ({}));
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const usedToday = async () => (await db.from('food_scans').select('id', { count: 'exact', head: true }).eq('kind', 'photo').gte('created_at', since)).count ?? 0;

  try {
    if (body.action === 'status') {
      const { data: key } = await db.rpc('ai_secret_get');
      return json({ configured: !!key, used: await usedToday(), limit: DAILY_LIMIT });
    }
    if (body.action === 'save_key') {
      const key = String(body.key ?? '').trim();
      if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return json({ error: 'bad_key' }, 400);
      try { await new Anthropic({ apiKey: key }).models.retrieve(MODEL); }
      catch (e) { return json({ error: e instanceof Anthropic.AuthenticationError ? 'bad_key' : 'key_check_failed' }, 400); }
      await db.rpc('ai_secret_put', { p: key });
      return json({ ok: true });
    }
    if (body.action === 'clear_key') { await db.rpc('ai_secret_clear'); return json({ ok: true }); }

    if (body.action === 'photo') {
      const media = MEDIA.find((m) => m === body.media_type);
      const image = typeof body.image === 'string' ? body.image : '';
      if (!media || !image || image.length > 6_000_000) return json({ error: 'bad_image' }, 400);
      const { data: key } = await db.rpc('ai_secret_get');
      if (!key) return json({ error: 'no_key' }, 400);
      if ((await usedToday()) >= DAILY_LIMIT) return json({ error: 'daily_limit', limit: DAILY_LIMIT }, 429);

      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
      const client = new Anthropic({ apiKey: key as string });
      // Safety classifiers may decline; the server-side fallback re-runs the request on another model in that case.
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: image } },
            { type: 'text', text: note ? `Note from the parents: ${note}` : 'Estimate what is in this photo.' },
          ],
        }],
      });

      if (response.stop_reason === 'refusal') return json({ error: 'refused' }, 422);
      const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text ?? '';
      let est;
      try { est = cleanEstimate(JSON.parse(text)); } catch { return json({ error: 'unreadable' }, 502); }
      if (mentionsDosing(est.notes_ar)) est.notes_ar = '';
      if (mentionsDosing(est.notes_en)) est.notes_en = '';
      const { data: row } = await db.from('food_scans').insert({
        created_by: userId, kind: 'photo', model: response.model, result: est,
        input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens,
      }).select('id').single();
      return json({ scan_id: (row as { id: string } | null)?.id ?? null, estimate: est });
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'bad_key' }, 400);
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'busy' }, 429);
    if (e instanceof Anthropic.APIError) { console.error('carb-food api', e.status, e.message); return json({ error: 'upstream' }, 502); }
    console.error('carb-food', e instanceof Error ? e.message : e);
    return json({ error: 'server' }, 500);
  }
});
