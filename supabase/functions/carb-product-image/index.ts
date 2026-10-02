// Fetches each product's picture from the maker's page it came from (products.source_url) and keeps a copy in
// the app's own photo storage, so it loads fast and survives the maker changing its site. Members only (or the
// database with the cron secret). Never overwrites a photo the family took. Only the maker's own sites
// (kddc.com, eshop.kddc.com) are read; only the picture columns are written, never nutrition.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { allowedHost, pickImage, pictures, shareImage, toHttps } from './lib.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { db: { schema: 'carb' }, auth: { persistSession: false } });
  const secret = req.headers.get('x-cron-secret');
  if (secret) {
    const { data: ok } = await db.rpc('cron_secret_matches', { p: secret });
    if (!ok) return json({ error: 'not_allowed' }, 403);
  } else {
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, db: { schema: 'carb' }, auth: { persistSession: false } });
    const { data: member } = await asUser.rpc('is_member');
    if (!member) return json({ error: 'not_allowed' }, 403);
  }
  const body = await req.json().catch(() => ({})) as { ids?: string[] };
  // look only: the pictures a page offers (to see why one was not matched)
  if ((body as { inspect?: string }).inspect) {
    const u = toHttps((body as { inspect: string }).inspect);
    if (!allowedHost(u)) return json({ error: 'not_a_maker_page' }, 400);   // the maker's own sites only
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    const html = r && r.ok ? await r.text() : '';
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
    const at = text.search(/nutrition|calories|energy/i);
    const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
    return json({ status: r?.status ?? 0, title, share: shareImage(html, u), pictures: pictures(html, u).slice(0, 80), nutrition: at < 0 ? null : text.slice(Math.max(0, at - 200), at + 1500) });
  }

  let q = db.from('products').select('id,name,source_url,image_path').not('source_url', 'is', null);
  q = body.ids?.length ? q.in('id', body.ids.slice(0, 50)) : q.is('image_path', null);
  const { data: rows, error } = await q;
  if (error) return json({ error: error.message }, 500);
  const all = (rows ?? []) as { id: string; name: string; source_url: string; image_path: string | null }[];
  const { data: every } = await db.from('products').select('source_url').not('source_url', 'is', null);
  const count = new Map<string, number>(); for (const r of (every ?? []) as { source_url: string }[]) count.set(r.source_url, (count.get(r.source_url) ?? 0) + 1);

  const pages = new Map<string, string | null>();
  const page = async (u: string) => {
    if (!pages.has(u)) {
      try { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(15000) }); pages.set(u, r.ok ? await r.text() : null); }
      catch { pages.set(u, null); }
    }
    return pages.get(u)!;
  };

  const results = [];
  for (const p of all) {
    if (p.image_path && !body.ids?.length) continue;           // a family photo is never replaced
    const src = toHttps(p.source_url);
    if (!allowedHost(src)) { results.push({ name: p.name, ok: false, why: 'not_a_maker_page' }); continue; }
    const html = await page(src);
    if (!html) { results.push({ name: p.name, ok: false, why: 'page_unreachable' }); continue; }
    const img = pickImage(html, src, p.name, (count.get(p.source_url) ?? 0) > 1);
    if (!img) { results.push({ name: p.name, ok: false, why: 'no_matching_picture' }); continue; }
    try {
      if (!allowedHost(img)) { results.push({ name: p.name, ok: false, why: 'not_a_maker_picture' }); continue; }
      const r = await fetch(img, { headers: { 'User-Agent': UA, Referer: src }, signal: AbortSignal.timeout(15000) });
      const type = (r.headers.get('content-type') ?? '').split(';')[0].trim();
      const buf = new Uint8Array(await r.arrayBuffer());
      if (!r.ok || !EXT[type] || buf.length > 2_000_000 || buf.length < 2000) { results.push({ name: p.name, ok: false, why: `bad_image:${type}:${buf.length}`, img }); continue; }
      const path = `products/maker-${p.id}.${EXT[type]}`;
      const up = await db.storage.from('carb-photos').upload(path, buf, { contentType: type, upsert: true });
      if (up.error) { results.push({ name: p.name, ok: false, why: up.error.message }); continue; }
      await db.from('products').update({ image_path: path, image_source: img }).eq('id', p.id);
      results.push({ name: p.name, ok: true, img });
    } catch (e) { results.push({ name: p.name, ok: false, why: String(e).slice(0, 120), img }); }
  }
  return json({ checked: results.length, got: results.filter((r) => r.ok).length, results });
});
