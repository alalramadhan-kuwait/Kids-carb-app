// The visit report's last section: "Observations & questions for the care team". The findings come from
// engine/report/observations.ts; this only puts them into words, in the language chosen for the family pages.
// Each finding: what was observed, the evidence, possible explanations (not confirmed), the question, and room for
// the care team's notes. It never shows a new dose, ratio or correction factor.
import type { ReactNode } from 'react';
import { formatGlucose, unitLabel, type GlucoseUnit } from '../../lib/glucose';
import type { Finding, Gap, Observations } from '../../engine/report/observations';
import { OBS_RULES } from '../../engine/report/observations';
import { isEn, locale, t } from '../../i18n';

const SLOT: Record<string, string> = { breakfast: 'الإفطار', lunch: 'الغداء', dinner: 'العشاء', snack: 'السناكات' }; // i18n-ok: shown through t()
const BLOCK: Record<string, string> = { night: 'الليل (12–6 ص)', morning: 'الصباح', afternoon: 'الظهر', evening: 'المساء' }; // i18n-ok: shown through t()
const ISSUE: Record<string, string> = { // i18n-ok: shown through t()
  protein_low: 'بروتين أقل من المرجع', fiber_low: 'ألياف قليلة', calcium_low: 'كالسيوم قليل', iron_low: 'حديد قليل', potassium_low: 'بوتاسيوم قليل', vit_d_low: 'فيتامين د قليل', // i18n-ok
  few_vegetables: 'خضار قليلة', few_fruit: 'فواكه قليلة', sat_fat_high: 'دهون مشبعة عالية', sugar_added_high: 'سكر مضاف عالٍ', sodium_high: 'صوديوم عالٍ', // i18n-ok
};
const REASON: Record<string, string> = { // i18n-ok: shown through t()
  bmi_thinness: 'مؤشر الكتلة منخفض', bmi_obesity: 'مؤشر الكتلة مرتفع', height_short: 'الطول أقل من المتوقع', bmi_z_drop: 'نزول في منحنى مؤشر الكتلة', // i18n-ok
  height_z_drop: 'نزول في منحنى الطول', weight_down: 'نقص في الوزن', height_stalled: 'الطول لم يتغير', height_decreased: 'الطول المسجَّل نقص (خطأ قياس؟)', // i18n-ok
};
const MAYBE: Record<string, string> = { // i18n-ok: shown through t()
  m_late_dose: 'في {k} من {n} مرات أُعطي النوفورابيد بعد بدء الأكل', // i18n-ok
  m_start_high: 'في {k} من {n} مرات كان السكر فوق النطاق قبل الأكل', // i18n-ok
  m_makeup: '{k} من {n} وجبات كانت غنية بالدهون أو البروتين، أو بلغت ذروتها بعد ساعتين ونصف أو أكثر', // i18n-ok
  m_unknown_carbs: '{k} وجبات بكارب غير معروف في هذه الفترة، لم تدخل في الحساب', // i18n-ok
  m_carb_count: 'دقة عدّ الكارب (الوزن الفعلي أو الملصق)', // i18n-ok
  m_eating_unsure: 'الجرعة بعد الأكل قد تكون مقصودة عندما لا نعرف كم ستأكل', // i18n-ok
  m_logging_time: 'وقت التسجيل قد يختلف عن وقت الإعطاء الفعلي', // i18n-ok
  m_not_logged: 'قد تكون الجرعة أُعطيت ولم تُسجَّل', // i18n-ok
  m_small_snack: 'بعض هذه الوجبات قد لا تحتاج جرعة حسب خطة الطبيب', // i18n-ok
  m_rise_not_over: 'قد يكون السكر ما زال يرتفع لسبب آخر (أكل سابق، توتر، مرض)', // i18n-ok
  m_activity_or_stacking: 'نشاط بعد التصحيح، أو إنسولين ما زال يعمل', // i18n-ok
  m_dose_rounding: 'تقريب الجرعة لأقرب خطوة في القلم', // i18n-ok
  m_compression: 'بعض القراءات الليلية المنخفضة قد تكون من الضغط على الحساس أثناء النوم (يُتأكد منها بوخز الإصبع)', // i18n-ok
  m_dawn: 'ارتفاع الفجر الطبيعي', // i18n-ok
  m_evening_activity: 'نشاط في المساء أو عشاء متأخر', // i18n-ok
  m_stacking: '{k} انخفاضات جاءت بعد جرعتين سريعتين أو أكثر خلال 4 ساعات', // i18n-ok
  m_activity: '{k} انخفاضات جاءت خلال 6 ساعات بعد نشاط مسجَّل', // i18n-ok
  m_food_not_logged: 'قد لا يكون كل الأكل مسجَّلًا', // i18n-ok
  m_estimate_range: 'الاحتياج تقدير من معادلة، وله هامش', // i18n-ok
  m_label_gaps: 'بعض المنتجات بلا قيم كاملة على الملصق', // i18n-ok
  m_dose_side: 'الجرعة وتوقيتها يؤثران أيضًا (للطبيب)', // i18n-ok
};
const GAP: Record<string, string> = { // i18n-ok: shown through t()
  gap_meal: '{slot}: {n} من {all} مرات فقط فيها قراءات وجرعة (نحتاج {need} على الأقل)', // i18n-ok
  gap_corr: 'التصحيح: {n} تصحيح واضح فقط من {all} (تبعها أكل: {food}، إنسولين آخر: {iob}، نقص قراءات: {data}). نحتاج {need} على الأقل', // i18n-ok
  gap_night: 'الليل: {n} فترات ليلية فقط بلا أكل أو إنسولين سريع لساعات (نحتاج {need} على الأقل) للحكم على التريسيبا', // i18n-ok
  gap_energy: 'الطاقة: الأكل المسجَّل يغطي {cov}% فقط من المعلومات الغذائية خلال {days} أيام', // i18n-ok
  gap_growth: 'النمو: {n} قياس فقط، ولا يُحكم على مسار النمو إلا بقياسين أو أكثر', // i18n-ok
};

export function ObservationsSection({ obs, unit }: { obs: Observations; unit: GlucoseUnit }) {
  const u = unitLabel(unit), g = (mg: number | null | undefined) => (mg == null ? '–' : formatGlucose(mg, unit));
  const day = (ms: number) => new Date(ms).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
  const when = (ms: number) => `${day(ms)} ${new Date(ms).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuwait', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions)}`;
  // each day once, with how many times when more than one
  const dates = (xs: number[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(day(x), (m.get(day(x)) ?? 0) + 1); return [...m].map(([k, n]) => (n > 1 ? `${k} (×${n})` : k)).join(isEn() ? ', ' : '، '); }; // i18n-ok: list commas
  const sl = (k: string) => (isEn() ? t(SLOT[k]).toLowerCase() : t(SLOT[k]));
  const clockMin = (m: number | null) => (m == null ? '–' : `${Math.floor(m / 60) % 12 || 12}:${String(Math.round(m % 60)).padStart(2, '0')} ${m < 720 ? (isEn() ? 'am' : 'ص') : (isEn() ? 'pm' : 'م')}`); // i18n-ok: list commas and am/pm
  const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x)}%`);
  const n1 = (x: number | null | undefined, d = 0) => (x == null ? '–' : x.toFixed(d));

  const words = (f: Finding): { title: string; obs: string; ev: ReactNode[]; q: string } => {
    const d = f.data, slot = d.slot ? sl(d.slot) : '';
    switch (f.kind) {
      case 'meal_rise': return {
        title: t('ارتفاع متكرر بعد {slot}', { slot }),
        obs: t('ارتفع السكر بوضوح بعد {slot} في {k} من {n} مرات سُجّلت فيها جرعة وقراءات.', { slot, k: d.k, n: d.n }),
        ev: [
          t('قبل الأكل {pre} ← بعد ساعتين {at2h} {u} (الوسيط)؛ الذروة {peak} بعد حوالي {pm} دقيقة', { pre: g(d.pre), at2h: g(d.at2h), u, peak: g(d.peak), pm: n1(d.peakMin) }),
          t('الكارب {c} غ · النوفورابيد {units} وحدة (الوسيط)', { c: n1(d.carbs), units: n1(d.units, 1) }) + ' · ' + (d.doseMin == null ? '' : d.doseMin >= 0 ? t('أُعطي قبل الأكل بـ {m} دقيقة', { m: d.doseMin }) : t('أُعطي بعد بدء الأكل بـ {m} دقيقة', { m: -d.doseMin })),
          d.cr ? t('النسبة المستخدمة الآن في هذا الوقت: وحدة لكل {cr} غ', { cr: d.cr }) : null,
          d.lowsAfter ? t('تبعها انخفاض {k} مرة', { k: d.lowsAfter }) : null,
          t('التواريخ: {d}', { d: dates(d.dates) }),
        ],
        q: t('هل نراجع نسبة الكارب في {slot}، أو توقيت النوفورابيد، أو أسبابًا أخرى لهذا الارتفاع المتكرر؟', { slot }),
      };
      case 'dose_timing': return {
        title: t('توقيت النوفورابيد مع الأكل'),
        obs: t('أُعطي النوفورابيد بعد بدء الأكل في {k} من {n} وجبات.', { k: d.k, n: d.n }),
        ev: [
          t('بعد بدء الأكل بحوالي {m} دقيقة (الوسيط)', { m: n1(d.medianAfter) }),
          d.at2hBefore != null ? t('السكر بعد ساعتين ({u}): {a} حين أُعطي بعد الأكل، و{b} حين أُعطي قبله بـ 10 دقائق أو أكثر ({nb} وجبات)', { a: g(d.at2hAfter), b: g(d.at2hBefore), u, nb: d.nBefore }) : t('لا توجد وجبات كافية أُعطيت جرعتها قبل الأكل بـ 10 دقائق للمقارنة'),
          t('التواريخ: {d}', { d: dates(d.dates) }),
        ],
        q: t('ما التوقيت المناسب للنوفورابيد قبل الأكل لليان، وماذا نفعل عندما لا نعرف كم ستأكل؟'),
      };
      case 'missed_dose': return {
        title: t('وجبات بلا جرعة مسجَّلة'),
        obs: t('{k} من {n} وجبات (15 غ كارب أو أكثر) لم تُسجَّل لها جرعة سريعة.', { k: d.k, n: d.n }),
        ev: [d.at2h != null ? t('السكر بعد ساعتين (الوسيط): {v} {u}', { v: g(d.at2h), u }) : null, t('التواريخ: {d}', { d: dates(d.dates) })],
        q: t('ما الخطة للوجبات والسناكات التي لا تُعطى لها جرعة؟'),
      };
      case 'corrections': return {
        title: t('جرعات التصحيح'),
        obs: !d.flagged ? t('في معظم التصحيحات الواضحة ({n}) عاد السكر إلى النطاق خلال 3 ساعات بدون انخفاض.', { n: d.n })
          : d.notReached >= d.lowAfter ? t('في {k} من {n} تصحيحات واضحة بقي السكر فوق النطاق بعد 3 ساعات.', { k: d.notReached, n: d.n })
            : t('{k} من {n} تصحيحات واضحة تبعها انخفاض خلال 4 ساعات.', { k: d.lowAfter, n: d.n }),
        ev: [
          t('قبل التصحيح {a} ← بعد 3 ساعات {b} {u} (الوسيط)، الجرعة {units} وحدة', { a: g(d.g0), b: g(d.g3), u, units: n1(d.units, 1) }),
          t('«واضح» = بلا أكل أو إنسولين سريع آخر خلال 3 ساعات: {n} من {all} تصحيحات', { n: d.n, all: d.all }),
          d.flagged && d.lowAfter && d.notReached >= d.lowAfter ? t('تبعها انخفاض: {k}', { k: d.lowAfter }) : null,
          t('التواريخ: {d}', { d: dates(d.dates) }),
        ],
        q: d.flagged ? t('هل تحتاج طريقة التصحيح أو معامل التصحيح إلى مراجعة، أم هناك تفسير آخر لهذه النتائج؟') : t('هل طريقة التصحيح الحالية مناسبة كما هي؟'),
      };
      case 'overnight': return {
        title: t('الليل بعد ٦ ساعات من النوفورابيد'),
        obs: !d.flagged ? t('كان السكر مستقرًا تقريبًا في معظم الفترات الليلية ({n}) بلا أكل أو إنسولين سريع.', { n: d.n })
          : d.low >= 2 ? t('وصل السكر تحت النطاق في {k} من {n} فترات ليلية بلا أكل أو إنسولين سريع.', { k: d.low, n: d.n })
            : d.falling >= d.rising ? t('نزل السكر باستمرار في {k} من {n} فترات ليلية بلا أكل أو إنسولين سريع.', { k: d.falling, n: d.n })
              : t('ارتفع السكر باستمرار في {k} من {n} فترات ليلية بلا أكل أو إنسولين سريع.', { k: d.rising, n: d.n }),
        ev: [
          d.rate != null ? t('التغير (الوسيط): {r} {u} كل ساعة', { r: (d.rate > 0 ? '+' : d.rate < 0 ? '−' : '') + g(Math.abs(d.rate)), u }) : null,
          d.longUnits != null ? t('التريسيبا: {units} وحدة، عادة الساعة {time}', { units: n1(d.longUnits, 1), time: clockMin(d.longTime) }) : null,
          d.dates.length ? t('ليالٍ وصل فيها تحت النطاق: {d}', { d: dates(d.dates) }) : null,
        ],
        q: d.flagged ? t('هل تحتاج جرعة التريسيبا أو توقيتها إلى مراجعة؟') : t('هل جرعة التريسيبا وتوقيتها مناسبان كما هما؟'),
      };
      case 'lows': return {
        title: t('الانخفاضات'),
        obs: d.top ? t('{n} انخفاضات (أقل من 3.9 لمدة 15 دقيقة أو أكثر)، أكثرها في {block} ({k}).', { n: d.n, block: t(BLOCK[d.top]), k: d.topN }) : t('{n} انخفاضات (أقل من 3.9 لمدة 15 دقيقة أو أكثر)، موزعة على أوقات اليوم.', { n: d.n }),
        ev: [
          t('الليل {a} · الصباح {b} · الظهر {c} · المساء {e}', { a: d.blocks.night, b: d.blocks.morning, c: d.blocks.afternoon, e: d.blocks.evening }),
          t('خلال 4 ساعات بعد نوفورابيد: {k} · بعد أكل: {m}', { k: d.afterDose, m: d.afterMeal }),
          t('أدنى قراءة {v} {u} · المدة (الوسيط) {min} دقيقة · علاجات انخفاض مسجَّلة {tr}', { v: g(d.lowest), u, min: n1(d.minutes), tr: d.treatments }),
          t('آخرها: {list}', { list: d.list.map((x: any) => `${when(x.at)} (${g(x.min)})`).join(isEn() ? '; ' : '؛ ') }), // i18n-ok: list commas and am/pm
        ],
        q: d.top ? t('ما الذي قد يسبب الانخفاضات في {block}، وهل نغيّر شيئًا في الخطة لتجنبها؟', { block: t(BLOCK[d.top]) }) : t('هل ترون نمطًا في هذه الانخفاضات، وهل نغيّر شيئًا في الخطة لتجنبها؟'),
      };
      case 'energy': return {
        title: t('الطاقة (السعرات)'),
        obs: d.state === 'within' ? t('متوسط ما أكلته {kcal} سعرة يوميًا، ضمن الاحتياج المقدَّر ({lo}–{hi}).', { kcal: n1(d.kcal), lo: d.low, hi: d.high })
          : d.state === 'below' ? t('متوسط ما أكلته {kcal} سعرة يوميًا، أقل من الاحتياج المقدَّر ({lo}–{hi}).', { kcal: n1(d.kcal), lo: d.low, hi: d.high })
            : t('متوسط ما أكلته {kcal} سعرة يوميًا، أعلى من الاحتياج المقدَّر ({lo}–{hi}).', { kcal: n1(d.kcal), lo: d.low, hi: d.high }),
        ev: [t('على مدى {days} أيام مكتملة؛ المعلومات الغذائية تغطي {cov}% من الأكل', { days: d.days, cov: d.cov }), d.source === 'dietitian' ? t('المرجع: رقم أخصائية التغذية') : t('المرجع: معادلة الاحتياج (NASEM 2023) لعمرها ووزنها وطولها')],
        q: d.state === 'below' ? t('هل يكفي أكلها للنمو؟ وكيف نزيد الطاقة دون ارتفاعات في السكر؟') : d.state === 'above' ? t('هل كمية الطاقة مناسبة لعمرها ونشاطها؟') : t('هل يغطي أكلها احتياجها للنمو كما هو؟'),
      };
      case 'growth': return {
        title: t('النمو'),
        obs: t('آخر قياس ({on}): الوزن {w} كغ (المئين {pw})، الطول {h} سم (المئين {ph})، مؤشر الكتلة في المئين {pb}.', { on: d.on, w: n1(d.weight, 1), pw: n1(d.pW), h: n1(d.height, 1), ph: n1(d.pH), pb: n1(d.pBmi) }),
        ev: [d.reasons.length ? t('لاحظ التطبيق: {list}', { list: d.reasons.map((r: string) => t(REASON[r] ?? r)).join(isEn() ? ', ' : '، ') }) : null, t('عدد القياسات: {n}', { n: d.measurements }), d.change90 != null ? t('تغير الوزن خلال 90 يومًا: {c} كغ', { c: (d.change90 > 0 ? '+' : '') + d.change90.toFixed(1) }) : null, t('المرجع: منحنيات منظمة الصحة العالمية للأطفال')], // i18n-ok: list commas and am/pm
        q: t('هل الوزن والطول مناسبان لعمرها، ومتى نقيس مرة أخرى؟'),
      };
      case 'balance': return {
        title: t('توازن الوجبات'),
        obs: t('من الطاقة: كارب {c} · دهون {f} · بروتين {p}', { c: pct(d.carbs), f: pct(d.fat), p: pct(d.protein) }),
        ev: [d.issues.length ? t('لاحظ التطبيق: {list}', { list: d.issues.map((i: string) => t(ISSUE[i] ?? i)).join(isEn() ? ', ' : '، ') }) : null, t('على مدى {days} أيام؛ المعلومات الغذائية تغطي {cov}% من الأكل', { days: d.days, cov: d.cov })], // i18n-ok: list commas and am/pm
        q: t('هل نراجع نسبة الكارب والدهون والبروتين في وجباتها، وما الذي نضيفه أو نقلله؟'),
      };
      case 'meal_makeup': return {
        title: t('الوجبات التي تبعها ارتفاع'),
        obs: d.repeated.length ? t('تكرر الارتفاع بعد نفس الوجبة: {list}', { list: d.repeated.map((r: any) => `${r.name} (${r.k})`).join(isEn() ? ', ' : '، ') }) // i18n-ok: list commas and am/pm
          : t('{k} من {n} وجبات تبعها ارتفاع كانت غنية بالدهون أو البروتين.', { k: d.fatty, n: d.withMk }),
        ev: [
          d.withMk ? t('غنية بالدهون أو البروتين: {a} من {b} وجبات الارتفاع، مقابل {c} من {e} وجبات بلا ارتفاع', { a: d.fatty, b: d.withMk, c: d.calmFatty, e: d.calm }) : null,
          t('ذروة متأخرة (ساعتان ونصف أو أكثر): {k} · الكارب (الوسيط): {c} غ', { k: d.latePeak, c: n1(d.carbs) }),
        ],
        q: d.repeated.length ? t('هل نغيّر كمية الكارب أو مكونات هذه الوجبات (مثل {name})؟', { name: d.repeated[0].name }) : t('هل نغيّر مكونات الوجبات الغنية بالدهون أو البروتين أو طريقة تقديمها؟'),
      };
      case 'carb_spread': return {
        title: t('كمية الكارب تتغير من يوم لآخر'),
        obs: t('كمية الكارب في نفس الوجبة تتغير كثيرًا من يوم لآخر.'),
        ev: d.list.map((x: any) => t('{slot}: من {lo} إلى {hi} غ (الوسيط {md} غ) في {n} مرات', { slot: t(SLOT[x.slot]), lo: n1(x.lo), hi: n1(x.hi), md: n1(x.md), n: x.n })),
        q: t('هل يساعد تثبيت كمية الكارب في الوجبات الرئيسية على التخطيط، مع الحفاظ على طاقة كافية للنمو؟'),
      };
    }
  };

  const Card = ({ f, i, who }: { f: Finding; i: number; who: string }) => {
    const w = words(f);
    return (
      <section className="space-y-1.5 rounded-xl border border-slate-200 p-3 text-[13px] leading-snug" style={{ breakInside: 'avoid' }}>
        <h3 className="text-[15px] font-bold">{i}. {w.title}</h3>
        <p><b>{t('الملاحظة')}:</b> {w.obs}</p>
        <div><b>{t('الدليل')}:</b><ul className="list-disc ps-5">{w.ev.filter(Boolean).map((e, k) => <li key={k}>{e}</li>)}</ul></div>
        {f.maybe.length > 0 && <div className="rounded-lg bg-slate-50 px-2 py-1"><b>{t('تفسيرات محتملة (غير مؤكدة)')}:</b><ul className="list-disc ps-5">{f.maybe.map((m, k) => <li key={k}>{t(MAYBE[m.key], m.p as never)}</li>)}</ul></div>}
        <p className="rounded-lg bg-brand-soft/60 px-2 py-1"><b>{who}:</b> «{w.q}»</p>
        <div><b className="text-slate-500">{t('ملاحظات الفريق الطبي')}:</b>{[0, 1, 2].map((k) => <div key={k} className="h-7 border-b border-slate-300" />)}</div>
      </section>
    );
  };
  const gapLine = (x: Gap) => t(GAP[x.key], { ...x.p, slot: x.p?.slot ? t(SLOT[x.p.slot]) : '' } as never);
  const gaps = (a: 'doctor' | 'dietitian') => obs.gaps.filter((x) => x.audience === a);

  return (
    <>
      <h1 className="text-xl font-bold">{t('ملاحظات وأسئلة لفريق الرعاية')}</h1>
      <p className="text-[12px] text-slate-600">{t('ما وجده التطبيق في سجلاتها خلال هذه الفترة، الأهم أولًا. لكل ملاحظة دليلها من الأرقام والتواريخ؛ «التفسيرات المحتملة» غير مؤكدة. هذه أسئلة للنقاش فقط: التطبيق لا يحسب ولا يقترح جرعة أو نسبة كارب أو معامل تصحيح.')}</p>
      <h2 className="pt-1 text-lg font-bold text-brand">{t('للطبيب')}</h2>
      {obs.doctor.length ? obs.doctor.map((f, i) => <Card key={f.kind + i} f={f} i={i + 1} who={t('سؤال للطبيب')} />) : <p className="text-sm text-slate-600">{t('لا توجد أنماط واضحة تستحق النقاش في هذه الفترة.')}</p>}
      {gaps('doctor').length > 0 && <section className="rounded-xl border border-dashed border-slate-300 p-3 text-[12.5px]"><b>{t('لا يكفي الدليل للحكم')}:</b><ul className="list-disc ps-5">{gaps('doctor').map((x, k) => <li key={k}>{gapLine(x)}</li>)}</ul></section>}
      <h2 className="pt-1 text-lg font-bold text-brand">{t('لأخصائية التغذية')}</h2>
      {obs.dietitian.length ? obs.dietitian.map((f, i) => <Card key={f.kind + i} f={f} i={obs.doctor.length + i + 1} who={t('سؤال لأخصائية التغذية')} />) : <p className="text-sm text-slate-600">{t('لا توجد أنماط واضحة تستحق النقاش في هذه الفترة.')}</p>}
      {gaps('dietitian').length > 0 && <section className="rounded-xl border border-dashed border-slate-300 p-3 text-[12.5px]"><b>{t('لا يكفي الدليل للحكم')}:</b><ul className="list-disc ps-5">{gaps('dietitian').map((x, k) => <li key={k}>{gapLine(x)}</li>)}</ul></section>}
      <p className="text-[11px] text-slate-500">
        {t('جودة البيانات: {s} وجبات في الفترة، {d} منها بجرعة مسجَّلة، {u} بكارب غير معروف.', { s: obs.quality.sittings, d: obs.quality.withDose, u: obs.quality.unknownCarbs })}{' '}
        {t('ارتفاع ({u}) = أعلى من {a} بعد ساعتين أو صعود {b} أو أكثر حتى الذروة. «متكرر» = نصف المرات على الأقل و{k} مرات أو أكثر.', { a: g(OBS_RULES.spike2hMg), b: g(OBS_RULES.riseMg), u, k: OBS_RULES.minRepeats })}
      </p>
      <section className="rounded-xl border border-slate-200 p-3"><h2 className="font-bold">{t('أسئلة أخرى')}</h2>{[0, 1, 2, 3, 4].map((k) => <div key={k} className="h-8 border-b border-slate-300" />)}</section>
    </>
  );
}
