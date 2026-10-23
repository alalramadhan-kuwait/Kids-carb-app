// The family's chosen looks for brands (carb.brand_looks), loaded once and shared by every screen that shows a badge.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { BrandLookRow } from './brandLook';

let cache: Map<string, BrandLookRow> | null = null;
const subs = new Set<(m: Map<string, BrandLookRow>) => void>();

async function load() {
  const { data } = await supabase.from('brand_looks').select('brand,kind,bg,emoji,photo_path');
  cache = new Map(((data ?? []) as BrandLookRow[]).map((r) => [r.brand, r]));
  subs.forEach((f) => f(cache!));
}

/** brand → the family's choice (empty until loaded; a brand with no row uses the look worked out from its food). */
export function useBrandLooks() {
  const [m, setM] = useState<Map<string, BrandLookRow>>(cache ?? new Map());
  useEffect(() => { subs.add(setM); if (!cache) load(); return () => { subs.delete(setM); }; }, []);
  return m;
}

export async function saveBrandLook(row: BrandLookRow) {
  const { error } = await supabase.from('brand_looks').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'brand' });
  if (error) throw new Error(error.message);
  await load();
}
