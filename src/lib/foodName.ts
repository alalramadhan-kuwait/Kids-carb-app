// A food's or recipe's name in the app's language: the curated Arabic or English name when there is one, else the
// name as entered. Used where one language matters (the dietitian sheet).
import { isEn } from '../i18n';

export interface Named { name: string; name_ar?: string | null; name_en?: string | null }
export const foodName = (x: Named, en = isEn()) => (en ? x.name_en : x.name_ar)?.trim() || x.name;
/** true when only the entered name exists, so it may be in the other language */
export const untranslated = (x: Named, en = isEn()) => !(en ? x.name_en : x.name_ar)?.trim();
