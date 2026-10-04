// The words for growth & nutrition, shared by the card on Now and the detail page so they always match.
// Observations only: never an instruction to eat less, never a dose.
import { tr } from '../i18n';

export const GROWTH_REASON_SHORT = tr({ // i18n-ok: values translated when read
  bmi_thinness: 'أقل من المدى (WHO)', bmi_obesity: 'أعلى من المدى (WHO)', height_short: 'الطول أقل من المدى', bmi_z_drop: 'تغيّر المسار', // i18n-ok
  height_z_drop: 'الطول: تغيّر المسار', weight_down: 'الوزن نقص', height_stalled: 'الطول ثابت', height_decreased: 'راجع قياس الطول', // i18n-ok
});
export const GROWTH_REASON = tr({ // i18n-ok: values translated when read
  bmi_thinness: 'مؤشر كتلة الجسم للعمر أقل من −2 انحراف معياري (نحافة حسب مرجع WHO 2007).', // i18n-ok
  bmi_obesity: 'مؤشر كتلة الجسم للعمر أعلى من +2 انحراف معياري (مرجع WHO 2007).', // i18n-ok
  height_short: 'الطول للعمر أقل من −2 انحراف معياري (مرجع WHO 2007).', // i18n-ok
  bmi_z_drop: 'مؤشر كتلة الجسم للعمر نزل عبر خط مئوي رئيسي خلال 3 أشهر أو أكثر.', // i18n-ok
  height_z_drop: 'الطول للعمر نزل عبر خط مئوي رئيسي خلال 3 أشهر أو أكثر.', // i18n-ok
  weight_down: 'الوزن أقل مما كان قبل شهرين أو أكثر بـ 3% أو أكثر.', // i18n-ok
  height_stalled: 'لم يزد الطول خلال 6 أشهر.', // i18n-ok
  height_decreased: 'آخر قياس للطول أقل من السابق: غالبًا خطأ في القياس أو الكتابة.', // i18n-ok
});
export const ENERGY_CHIP = tr({ within: 'الطاقة ضمن التقدير', below: 'الطاقة أقل من التقدير', above: 'الطاقة فوق التقدير', insufficient: 'الطاقة: أيام غير كافية' }); // i18n-ok
export const BALANCE_ISSUE = tr({ // i18n-ok: values translated when read
  protein_low: 'بروتين قليل', fiber_low: 'ألياف قليلة', few_vegetables: 'خضار قليلة', calcium_low: 'كالسيوم قليل', iron_low: 'حديد قليل', // i18n-ok
  few_fruit: 'فواكه قليلة', potassium_low: 'بوتاسيوم قليل', vit_d_low: 'فيتامين د قليل', sat_fat_high: 'دهون مشبعة عالية', // i18n-ok
  sugar_added_high: 'سكر مضاف عالٍ', sodium_high: 'صوديوم عالٍ', // i18n-ok
});
export const NUTRIENT_NAME = tr({ // i18n-ok: values translated when read
  carbs: 'الكربوهيدرات', protein: 'البروتين', fat: 'الدهون', sat_fat: 'الدهون المشبعة', fiber: 'الألياف', sugar_added: 'السكر المضاف', // i18n-ok
  sodium: 'الصوديوم', calcium: 'الكالسيوم', iron: 'الحديد', potassium: 'البوتاسيوم', vit_d: 'فيتامين د', // i18n-ok
});
export const STATE = tr({ // i18n-ok: values translated when read
  adequate: 'كافٍ', low: 'قليل', high: 'عالٍ', within: 'ضمن المرجع', below_ref: 'أقل من المرجع', above_ref: 'أعلى من المرجع', insufficient: 'بيانات غير كافية', // i18n-ok
});
export const GROUP = tr({ // i18n-ok: values translated when read
  vegetables: 'خضار', fruit: 'فواكه', grains: 'حبوب ونشويات', protein: 'بروتين (لحم، دجاج، بيض)', dairy: 'ألبان', legumes_nuts: 'بقوليات ومكسرات', // i18n-ok
  extras: 'حلويات ومشروبات محلاة ومصنّعة', fats: 'صلصات ودهون', mixed: 'أطباق مختلطة', // i18n-ok
});
export const ACTIVITY = tr({ inactive: 'غير نشطة', low_active: 'نشاط قليل', active: 'نشطة', very_active: 'نشطة جدًا' }); // i18n-ok
export const ACTIVITY_HINT = tr({ // i18n-ok: values translated when read
  inactive: 'أغلب اليوم جلوس', low_active: 'لعب خفيف يوميًا', active: 'لعب وحركة معظم اليوم', very_active: 'رياضة أو لعب مجهد يوميًا', // i18n-ok
});
export const BAND = tr({ // i18n-ok: values translated when read
  severe_thinness: 'نحافة شديدة', thinness: 'نحافة', normal: 'ضمن المدى الطبيعي', overweight: 'زيادة وزن', obesity: 'سمنة', // i18n-ok
  severe_short: 'قصر شديد', short: 'قصر', // i18n-ok
});
export const SOURCE = tr({ // i18n-ok: values translated when read
  ispad_2022: 'ISPAD 2022', iom_2005: 'IOM 2005', iom_2011: 'IOM 2011', iom_2001: 'IOM 2001', nasem_2019: 'NASEM 2019', dga_2020: 'DGA 2020–2025', dietitian: 'أخصائية التغذية', nasem_2023: 'NASEM 2023', // i18n-ok
});
