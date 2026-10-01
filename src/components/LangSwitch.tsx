import { setLang, useLang, type Lang } from '../i18n';
import { supabase } from '../lib/supabase';
import { cx } from './ui';

/** العربية | English. Each label is written in its own language so either reader can find theirs. Also saved to
 *  the parent's member row so push alerts arrive in the same language. */
export function LangSwitch({ className }: { className?: string }) {
  const l = useLang();
  const pick = (v: Lang) => {
    if (v === l) return;
    void supabase.rpc('set_my_lang', { p_lang: v }).then(() => undefined, () => undefined); // signed out: nothing to save
    setLang(v);
  };
  const opts: [Lang, string][] = [['ar', 'العربية'], ['en', 'English']]; // i18n-ok: data, each label in its own language
  return (
    <div className={cx('grid grid-cols-2 gap-1 rounded-full bg-slate-50 p-1', className)} role="radiogroup" aria-label="Language · اللغة"> {/* i18n-ok: data */}
      {opts.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={l === v} lang={v} onClick={() => pick(v)}
          className={cx('min-h-[44px] rounded-full text-sm font-bold', l === v ? 'bg-brand text-white' : 'text-slate-600')}>{label}</button>
      ))}
    </div>
  );
}
