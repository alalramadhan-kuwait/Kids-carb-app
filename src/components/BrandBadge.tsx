import { photoUrl } from '../lib/supabase';
import type { BrandLook } from '../lib/brandLook';

/** A brand's badge: its logo photo when the family took one, else its colour with initials and a food picture. */
export function BrandBadge({ look, size = 64 }: { look: BrandLook; size?: number }) {
  const m = look.mark, fs = size * (m.length > 3 ? 0.24 : m.length > 2 ? 0.3 : 0.36);
  return (
    <span aria-hidden className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {look.photo
        ? <img src={photoUrl(look.photo) ?? ''} alt="" className="h-full w-full rounded-2xl object-cover shadow-sm" />
        : <span className="grid h-full w-full place-items-center rounded-2xl font-black leading-none shadow-sm" dir="auto" style={{ background: look.bg, color: look.fg, fontSize: fs, letterSpacing: '-0.02em' }}>{m}</span>}
      <span className="absolute grid place-items-center rounded-full bg-white shadow" style={{ width: size * 0.48, height: size * 0.48, right: -size * 0.12, bottom: -size * 0.1, fontSize: size * 0.3 }}>{look.emoji}</span>
    </span>
  );
}
