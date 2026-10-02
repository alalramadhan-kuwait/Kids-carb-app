import { useState } from 'react';
import { Sheet } from './ui';
import { t } from '../i18n';

type Swatch = 'line' | 'dash' | 'dot' | 'past' | 'ins' | 'carb' | 'band';
function Mark({ s }: { s: Swatch }) {
  if (s === 'ins' || s === 'carb' || s === 'band')
    return <span className={s === 'ins' ? 'h-3 w-7 rounded-sm bg-kins-soft ring-1 ring-kins' : s === 'carb' ? 'h-3 w-7 rounded-sm bg-kcarb-soft ring-1 ring-kcarb' : 'h-3 w-7 rounded-sm bg-ok-soft ring-1 ring-ok-fill'} />;
  const d = s === 'dash' ? '6 4' : s === 'dot' ? '2 4' : s === 'past' ? '4 4' : undefined;
  return (
    <svg width="28" height="12" aria-hidden>
      <line x1="2" y1="6" x2="26" y2="6" strokeWidth={s === 'line' ? 3 : 2} strokeDasharray={d} strokeLinecap="round" className={s === 'past' ? 'stroke-slate-400' : 'stroke-brand'} />
      {s === 'past' && <circle cx="14" cy="6" r="3" className="fill-white stroke-slate-400" strokeWidth="1.2" />}
    </svg>
  );
}

/** A small ⓘ on the graph; the explanation of every line and strip opens only when asked for. */
export function GraphHelp({ past, tracks, className }: { past?: boolean; tracks?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const rows: [Swatch, string, string][] = [
    ['line', t('السكر'), t('القراءات من الحساس.')],
    ['band', t('النطاق'), t('المنطقة الخضراء: النطاق الذي حددتموه.')],
    ['dash', t('التقدير مع ما في الجسم'), t('إلى أين يتجه السكر حتى ينتهي مفعول الكارب والإنسولين المسجّلين. الرقم في آخره هو التقدير.')],
    ['dot', t('الاتجاه 30 د'), t('لو استمر السكر بنفس سرعته الآن، أين يكون بعد 30 دقيقة.')],
    ...(past ? [['past', t('توقع آخر وجبة'), t('ما توقّعه التطبيق وقت آخر وجبة. قارنوه بخط السكر لتروا دقة التوقع.')] as [Swatch, string, string]] : []),
    ...(tracks ? [
      ['ins', 'IOB', t('الإنسولين السريع الذي ما زال يعمل. بعد «الآن» متقطع: ما تبقّى منه.')] as [Swatch, string, string],
      ['carb', 'COB', t('الكارب الذي ما زال يُمتص. بعد «الآن» متقطع: ما تبقّى منه.')] as [Swatch, string, string],
    ] : []),
  ];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t('شرح الرسم')}
        className={'grid h-9 w-9 place-items-center rounded-full bg-white/90 text-base font-bold text-slate-500 shadow-sm ring-1 ring-slate-200 ' + (className ?? '')}>i</button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('شرح الرسم')}>
        <ul className="space-y-3">
          {rows.map(([s, name, text]) => (
            <li key={name} className="flex items-start gap-3">
              <span className="mt-1 flex w-8 shrink-0 justify-center"><Mark s={s} /></span>
              <span className="min-w-0"><b className="block text-sm">{name}</b><span className="text-sm text-slate-600">{text}</span></span>
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-600">{t('الخطوط المتقطعة للعرض فقط، وليست للجرعة. للجرعة استخدموا الحاسبة.')}</p>
      </Sheet>
    </>
  );
}
