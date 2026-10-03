import { useState } from 'react';
import { sharePdf } from '../lib/pdfShare';
import { Btn, toast } from './ui';
import { t } from '../i18n';

/**
 * "مشاركة PDF": makes the file, then opens the share sheet. The phone allows the share sheet only right after a tap,
 * so when making the file takes too long the button turns into "the PDF is ready, tap to share".
 */
export function SharePdf({ make, filename, title, disabled, className }: { make: () => Promise<Blob>; filename: string; title: string; disabled?: boolean; className?: string }) {
  const [state, setState] = useState<'idle' | 'making' | 'ready'>('idle');
  const [blob, setBlob] = useState<Blob | null>(null);
  const share = async (b: Blob) => {
    try {
      const r = await sharePdf(b, filename, title);
      if (r === 'downloaded') toast(t('حُفظ الملف ✓'));
      setState('idle'); setBlob(null);
    } catch (e) {
      if ((e as Error).name === 'NotAllowedError') { setBlob(b); setState('ready'); } else { toast(t('تعذّرت المشاركة: {e}', { e: (e as Error).message })); setState('idle'); }
    }
  };
  const go = async () => {
    if (state === 'ready' && blob) return share(blob);
    setState('making');
    try { await share(await make()); } catch (e) { toast(t('تعذّر إنشاء PDF: {e}', { e: (e as Error).message })); setState('idle'); }
  };
  return (
    <Btn kind="primary" className={className} disabled={disabled || state === 'making'} onClick={go}>
      {state === 'making' ? t('جارٍ تجهيز PDF…') : state === 'ready' ? t('PDF جاهز · اضغطوا للمشاركة') : t('مشاركة PDF')}
    </Btn>
  );
}
