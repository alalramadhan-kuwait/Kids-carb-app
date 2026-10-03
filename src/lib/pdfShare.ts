// Making a real PDF on the phone and handing it to the share sheet (WhatsApp, Files, Mail…). Each part of the page
// is drawn by the browser itself (html-to-image), so Arabic text keeps its shaping, then placed on A4 pages (jsPDF).
// Both libraries load only when a PDF is made.

export type Orientation = 'portrait' | 'landscape';

const A4 = { w: 210, h: 297 };

/**
 * One image per element. `fit: 'page'` puts each element on its own page, scaled to fit; `flow` lays them one after
 * another down the page and starts a new page when the next one does not fit (a long report).
 */
export async function makePdf(elements: HTMLElement[], o: { orientation: Orientation; fit: 'page' | 'flow'; marginMm?: number }): Promise<Blob> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const pdf = new jsPDF({ orientation: o.orientation, unit: 'mm', format: 'a4', compress: true });
  const W = o.orientation === 'landscape' ? A4.h : A4.w, H = o.orientation === 'landscape' ? A4.w : A4.h, m = o.marginMm ?? 8;
  const opts = { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: false };
  let y = m, first = true;
  for (const el of elements) {
    // a little room around each part: redrawn text can wrap a hair differently and would otherwise be cut off
    const room = { ...opts, width: el.offsetWidth + 16, height: el.scrollHeight + 28, style: { margin: '0', padding: '8px', boxSizing: 'border-box' as const } };
    await toCanvas(el, room).catch(() => null);          // Safari draws pictures and fonts only from the second pass
    const c = await toCanvas(el, room);
    const img = c.toDataURL('image/jpeg', 0.9);
    // full width, unless taller than a page (then scaled to fit it)
    const k = Math.min((W - 2 * m) / c.width, (H - 2 * m) / c.height);
    const w = c.width * k, h = c.height * k;
    if (o.fit === 'page') {
      if (!first) pdf.addPage();
      pdf.addImage(img, 'JPEG', (W - w) / 2, m, w, h);
    } else {
      if (!first && y + h > H - m) { pdf.addPage(); y = m; }
      pdf.addImage(img, 'JPEG', (W - w) / 2, y, w, h);
      y += h + 3;
    }
    first = false;
  }
  return pdf.output('blob');
}

/** The share sheet with the file; where sharing files is not possible, the file is downloaded instead. */
export async function sharePdf(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title }); return 'shared'; }
    catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; throw e; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}
