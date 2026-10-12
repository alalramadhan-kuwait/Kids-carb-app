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
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: o.orientation, unit: 'mm', format: 'a4', compress: true });
  await addHtmlPages(pdf, elements, { ...o, firstOnCurrent: true });
  return pdf.output('blob');
}

/**
 * The same, onto a PDF already started (the visit report puts drawn and pictured sections in one file). Starts a new
 * page in the given orientation, unless `firstOnCurrent` (the PDF's first, still empty page).
 */
export async function addHtmlPages(pdf: import('jspdf').jsPDF, elements: HTMLElement[], o: { orientation: Orientation; fit: 'page' | 'flow'; marginMm?: number; firstOnCurrent?: boolean }) {
  const { toCanvas } = await import('html-to-image');
  const W = o.orientation === 'landscape' ? A4.h : A4.w, H = o.orientation === 'landscape' ? A4.w : A4.h, m = o.marginMm ?? 8;
  const opts = { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: false };
  let y = m, first = true;
  const newPage = () => pdf.addPage('a4', o.orientation);
  const shot = async (el: HTMLElement) => {
    // a little room around each part: redrawn text can wrap a hair differently and would otherwise be cut off
    const room = { ...opts, width: el.offsetWidth + 16, height: el.scrollHeight + 28, style: { margin: '0', padding: '8px', boxSizing: 'border-box' as const } };
    await toCanvas(el, room).catch(() => null);          // Safari draws pictures and fonts only from the second pass
    const c = await toCanvas(el, room);
    // full width, unless taller than a page (then scaled to fit it)
    const k = Math.min((W - 2 * m) / c.width, (H - 2 * m) / c.height);
    return { img: c.toDataURL('image/jpeg', 0.9), w: c.width * k, h: c.height * k };
  };
  const shown = elements.filter((el) => el.offsetWidth && el.offsetHeight); // hidden: a print-only heading, an empty part
  let next = shown.length ? await shot(shown[0]) : null;
  for (let i = 0; i < shown.length; i++) {
    const cur = next!;
    next = i + 1 < shown.length ? await shot(shown[i + 1]) : null;
    if (o.fit === 'page') {
      if (!(first && o.firstOnCurrent)) newPage();
      pdf.addImage(cur.img, 'JPEG', (W - cur.w) / 2, m, cur.w, cur.h);
    } else {
      // a heading stays with what follows it
      const keep = /^H[1-3]$/.test(shown[i].tagName) && next && cur.h + next.h + 3 <= H - 2 * m ? next.h + 3 : 0;
      if (first ? !o.firstOnCurrent : y + cur.h + keep > H - m) { if (!(first && o.firstOnCurrent)) { newPage(); y = m; } }
      pdf.addImage(cur.img, 'JPEG', (W - cur.w) / 2, y, cur.w, cur.h);
      y += cur.h + 3;
    }
    first = false;
  }
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
