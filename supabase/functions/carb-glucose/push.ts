// Web Push with nothing but WebCrypto (works in Deno and Node): VAPID (RFC 8292) and
// aes128gcm payload encryption (RFC 8291). No library, so it can be tested against the RFC vectors.

export const b64u = {
  enc(b: ArrayBuffer | Uint8Array) {
    const u = b instanceof Uint8Array ? b : new Uint8Array(b);
    let s = ''; for (const c of u) s += String.fromCharCode(c);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(s: string) {
    const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    return Uint8Array.from(t, (c) => c.charCodeAt(0));
  },
};
const te = new TextEncoder();
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const subtle = () => globalThis.crypto.subtle;
const B = (u: Uint8Array) => u as unknown as BufferSource; // TS 5.7 typed-array generics vs WebCrypto

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await subtle().importKey('raw', B(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: B(salt), info: B(info) }, k, len * 8));
}

/** JWK for a P-256 key from its raw public point (65 bytes) and optional private scalar. */
export function p256Jwk(pub: Uint8Array, d?: Uint8Array): JsonWebKey {
  return { kty: 'EC', crv: 'P-256', x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), ...(d ? { d: b64u.enc(d) } : {}), ext: true };
}

/** RFC 8291 aes128gcm body for one push message. `fixed` is only for tests. */
export async function encryptPayload(
  plaintext: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array,
  fixed?: { salt: Uint8Array; asPublic: Uint8Array; asPrivate: Uint8Array },
) {
  const salt = fixed?.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  let asPriv: CryptoKey, asPublic: Uint8Array;
  if (fixed) {
    asPriv = await subtle().importKey('jwk', p256Jwk(fixed.asPublic, fixed.asPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    asPublic = fixed.asPublic;
  } else {
    const kp = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    asPriv = kp.privateKey; asPublic = new Uint8Array(await subtle().exportKey('raw', kp.publicKey));
  }
  const uaKey = await subtle().importKey('raw', B(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, asPriv, 256));
  const ikm = await hkdf(authSecret, ecdh, cat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle().importKey('raw', B(cek), 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: B(nonce) }, key, B(cat(plaintext, new Uint8Array([2])))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return cat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

export interface Vapid { publicKey: string; privateJwk: JsonWebKey; subject: string }

/** A new VAPID key pair: the public key (b64url, raw point) and the private key as JWK. */
export async function newVapid(subject: string): Promise<Vapid> {
  const kp = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  return { publicKey: b64u.enc(await subtle().exportKey('raw', kp.publicKey)), privateJwk: await subtle().exportKey('jwk', kp.privateKey), subject };
}

export async function vapidHeader(endpoint: string, v: Vapid, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64u.enc(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.enc(te.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: v.subject })));
  const key = await subtle().importKey('jwk', { ...v.privateJwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, B(te.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64u.enc(sig)}, k=${v.publicKey}`;
}

export interface PushSub { endpoint: string; p256dh: string; auth: string }

/** Sends one message. Returns the HTTP status; 404/410 mean the subscription is gone. */
export async function sendPush(sub: PushSub, payload: unknown, v: Vapid, o: { ttl?: number; urgency?: 'normal' | 'high'; topic?: string } = {}) {
  const body = await encryptPayload(te.encode(JSON.stringify(payload)), b64u.dec(sub.p256dh), b64u.dec(sub.auth));
  const headers: Record<string, string> = {
    authorization: await vapidHeader(sub.endpoint, v), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream',
    ttl: String(o.ttl ?? 600), urgency: o.urgency ?? 'high',
  };
  if (o.topic) headers.topic = o.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body: B(body) });
  const text = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200);
  return { status: res.status, error: text };
}
