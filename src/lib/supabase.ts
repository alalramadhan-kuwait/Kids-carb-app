import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** Everything this app owns lives in the `carb` schema; nothing here touches `public`. */
export const supabase = createClient(url, key, { db: { schema: 'carb' }, auth: { persistSession: true } });

export const photoUrl = (path: string | null | undefined) =>
  path ? supabase.storage.from('carb-photos').getPublicUrl(path).data.publicUrl : null;

/** Shrink a photo on the phone before upload: full-size camera shots are 4 MB+. */
export async function resizeImage(file: File, max = 900): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('image'))), 'image/jpeg', 0.82));
}

export async function uploadPhoto(file: File, folder: string): Promise<string> {
  const blob = await resizeImage(file);
  const path = `${folder}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('carb-photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}
