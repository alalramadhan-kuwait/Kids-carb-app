// LAYAN_WIDGET v2
// The Layan iPhone widget (Scriptable). Served with the app and run by the small loader the family pasted into
// Scriptable, so changes reach the phone without pasting again. Run as an async function body with TOKEN, LANG,
// APP, SUPABASE and KEY from the loader. Read-only: it calls carb.share_view with the widget's own share link.
// Insulin and carbs on board use the same model and inputs as the app (src/engine/iob.ts); the tests check both agree.

const WORDS = {
  ar: {
    child: "ليان", old: "قراءة قديمة", urgent: "منخفض جدًا", low: "منخفض", high: "مرتفع", ok: "ضمن النطاق", now: "الآن",
    ago: "قبل {m} د", agoWord: "قبل", in15: "خلال 15 د", expired: "الرابط انتهى", noReading: "لا قراءة",
    revoked: "الرابط انتهى أو أُلغي. أنشئوا ويدجت جديدًا من التطبيق: المزيد ← ويدجت الآيفون.",
    offline: "لا اتصال الآن. سيحاول مرة أخرى.", none: "لا توجد قراءات في آخر 3 ساعات.", cached: "بلا اتصال: آخر نسخة",
  },
  en: {
    child: "Layan", old: "Old reading", urgent: "Very low", low: "Low", high: "High", ok: "In range", now: "now",
    ago: "{m} min ago", agoWord: "ago", in15: "in 15 min", expired: "Link expired", noReading: "No reading",
    revoked: "The link expired or was revoked. Make a new widget in the app: More → iPhone widget.",
    offline: "No connection right now. It will try again.", none: "No readings in the last 3 hours.", cached: "Offline: last copy",
  },
};
const W = WORDS[LANG] || WORDS.ar;
const WORDS2 = LANG === "en" ? { now: "now", food: "food", insulin: "insulin" } : { now: "الحين", food: "أكل", insulin: "إنسولين" };
const MIN = 60000;
const ARROW = { 1: "⇊", 2: "↘", 3: "→", 4: "↗", 5: "⇈" };
// the app's day colours (src/index.css)
const C = {
  bg: "#FCF7F8", border: "#E4DCF9", ink: "#261E5C", text2: "#625A87", text3: "#9084A9", brand: "#5B48D6",
  band: "#E3F5EC", ins: "#2E7CD6", carb: "#C2408F",
  dot: { ok: "#46B98A", high: "#F2A541", low: "#E95F68", urgent: "#E95F68" },
  text: { ok: "#1F7A55", high: "#8F5A00", low: "#B83A44", urgent: "#B83A44" },
};
const GREY = C.text3;
const hhmm = (t) => { const x = new Date(t); return String(x.getHours()).padStart(2, "0") + ":" + String(x.getMinutes()).padStart(2, "0"); };

async function load() {
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.cacheDirectory(), "layan-widget.json");
  try {
    const r = new Request(SUPABASE + "/rest/v1/rpc/share_view");
    r.method = "POST";
    r.timeoutInterval = 15;
    r.headers = { apikey: KEY, "Content-Type": "application/json", "Content-Profile": "carb" };
    r.body = JSON.stringify({ p_token: TOKEN });
    const d = await r.loadJSON();
    if (d && !d.error) fm.writeString(cache, JSON.stringify(d));
    return d || { error: "offline" };
  } catch (e) {
    if (fm.fileExists(cache)) { const d = JSON.parse(fm.readString(cache)); d.offline = true; return d; }
    return { error: "offline" };
  }
}

// insulin on board: the exponential activity model (Loop), duration and peak from the care team (engine/iob.ts)
function iobFraction(t, dia, peak) {
  if (t <= 0) return 1;
  if (t >= dia) return 0;
  const tau = (peak * (1 - peak / dia)) / (1 - (2 * peak) / dia);
  const a = (2 * tau) / dia;
  const S = 1 / (1 - a + (1 + a) * Math.exp(-dia / tau));
  const f = 1 - S * (1 - a) * ((t * t / (tau * dia * (1 - a)) - t / tau - 1) * Math.exp(-t / tau) + 1);
  return Math.min(1, Math.max(0, f));
}

// worked out now, not when the data was read, so an offline copy still counts down
function onboard(ob, now) {
  if (!ob) return null;
  let iob = null, cob = null;
  if (ob.dia > 0 && ob.peak > 0 && ob.peak < ob.dia / 2) {
    iob = 0;
    for (const d of ob.doses || []) {
      const t = Date.parse(d.t);
      if (t <= now && now - t < ob.dia * MIN) iob += Number(d.u) * iobFraction((now - t) / MIN, ob.dia, ob.peak);
    }
  }
  if (ob.absorb > 0) {
    cob = 0;
    for (const c of ob.carbs || []) {
      const t = Date.parse(c.t);
      if (t <= now && now - t < ob.absorb * MIN) cob += Number(c.g) * (1 - (now - t) / (ob.absorb * MIN));
    }
  }
  if (iob === null && cob === null) return null;
  return {
    iob: iob === null ? null : iob.toFixed(1) + "u", cob: cob === null ? null : Math.round(cob) + "g",
    line: [iob === null ? null : "IOB " + iob.toFixed(1) + "u", cob === null ? null : "COB " + Math.round(cob) + "g"].filter(Boolean).join("  "),
  };
}

function view(d) {
  const rs = (d.readings || []).map((r) => ({ t: Date.parse(r.t), v: r.v, trend: r.trend }));
  const last = rs[rs.length - 1] || null;
  if (!last) return null;
  const mmol = d.unit !== "mgdl";
  const fmt = (mg) => (mmol ? (mg / 18).toFixed(1) : String(Math.round(mg)));
  const mins = Math.max(0, Math.round((Date.now() - last.t) / MIN));
  const stale = mins > 10;
  const before = rs.filter((r) => r.t <= last.t - 13 * MIN).pop();
  const delta = before && last.t - before.t <= 20 * MIN ? last.v - before.v : null;
  const level = last.v < 54 ? "urgent" : last.v < d.low ? "low" : last.v > d.high ? "high" : "ok";
  const color = stale ? C.text3 : C.text[level];
  return {
    rs, last, level, value: fmt(last.v), clock: hhmm(last.t), arrow: stale ? "" : ARROW[last.trend] || "", unit: mmol ? "mmol/L" : "mg/dL",
    age: mins < 1 ? W.now : W.ago.replace("{m}", mins), stale, color, word: stale ? W.old : W[level],
    delta: delta === null || stale ? "" : (delta >= 0 ? "+" : "−") + fmt(Math.abs(delta)) + " " + W.in15,
    onboard: onboard(d.onboard, Date.now()),
  };
}

// the widget's size in points for this iPhone (Apple's widget sizes by screen width), so the drawing fills it
function widgetSize(fam) {
  const w = Device.screenSize().width;
  const m = w >= 428 ? [364, 170, 382] : w >= 414 ? [360, 169, 379] : w >= 390 ? [338, 158, 354] : w >= 375 ? [329, 155, 345] : [292, 141, 311];
  return fam === "small" ? new Size(m[1], m[1]) : fam === "large" ? new Size(m[0], m[2]) : new Size(m[0], m[1]);
}

const levelOf = (d, mg) => (mg < 54 ? "urgent" : mg < d.low ? "low" : mg > d.high ? "high" : "ok");

// The readings as one thin line. The sensor's jitter is taken out first (a median of 3, then the average of the readings
// within 7.5 minutes either side); the latest point stays the real reading so the line ends at the value shown. A gap
// longer than 20 minutes is still joined, but faintly, so it is not mistaken for readings. Each stretch takes the colour
// of her range (in range, high, low).
function smoothed(rs) {
  const med = rs.map((r, i) => { const w = rs.slice(Math.max(0, i - 1), i + 2).map((q) => q.v).sort((a, b) => a - b); return { t: r.t, v: w[Math.floor(w.length / 2)] }; });
  const out = med.map((r) => { const w = med.filter((q) => Math.abs(q.t - r.t) <= 7.5 * MIN); return { t: r.t, v: w.reduce((s, q) => s + q.v, 0) / w.length }; });
  if (out.length) out[out.length - 1] = { t: rs[rs.length - 1].t, v: rs[rs.length - 1].v };
  return out;
}

function readingLine(ctx, d, rs, t0, x, y, width) {
  const pts = smoothed(rs.filter((r) => r.t >= t0));
  let path = null, key = null;
  const flush = () => { if (!path) return; ctx.addPath(path); ctx.setStrokeColor(new Color(key.color, key.gap ? 0.3 : 1)); ctx.setLineWidth(width); ctx.strokePath(); path = null; };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const k = { color: C.dot[levelOf(d, (a.v + b.v) / 2)], gap: b.t - a.t > 20 * MIN };
    if (!path || k.color !== key.color || k.gap !== key.gap) { flush(); path = new Path(); path.move(new Point(x(a.t), y(a.v))); key = k; }
    path.addLine(new Point(x(b.t), y(b.v)));
  }
  flush();
}

// the background, edge to edge: her range, hour lines and labels, the readings as a line, meals and doses as markers
function background(d, v, size, chartTop) {
  const ctx = new DrawContext();
  ctx.size = size;
  ctx.opaque = true;
  ctx.respectScreenScale = true;
  const W = size.width, H = size.height, x0 = 6, x1 = W - 6, y0 = chartTop, y1 = H - 18;
  ctx.setFillColor(new Color(C.bg));
  ctx.fillRect(new Rect(0, 0, W, H));
  const vals = v.rs.map((r) => r.v);
  const lo = Math.min(54, ...vals), hi = Math.max(200, ...vals);
  const y = (mg) => y1 - ((mg - lo) / (hi - lo)) * (y1 - y0);
  const t1 = Date.now(), t0 = t1 - 3 * 60 * MIN;
  const x = (t) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
  // her range
  ctx.setFillColor(new Color(C.band));
  ctx.fillRect(new Rect(x0, y(d.high), x1 - x0, y(d.low) - y(d.high)));
  // hour lines and labels
  ctx.setFont(Font.mediumSystemFont(10));
  ctx.setTextColor(new Color(C.text3));
  ctx.setTextAlignedCenter();
  for (let h = new Date(t0).setMinutes(0, 0, 0) + 60 * MIN; h < t1; h += 60 * MIN) {
    const px = x(h);
    ctx.setFillColor(new Color(C.border));
    ctx.fillRect(new Rect(px - 0.5, y0 - 4, 1, y1 - y0 + 4));
    const hr = new Date(h).getHours();
    if (px - 16 >= 0 && px + 16 <= W) ctx.drawTextInRect(String(hr).padStart(2, "0") + ":00", new Rect(px - 20, y1 + 3, 40, 14)); // no label cut by an edge
  }
  // meals and doses (widget links carry them), as small marks on the bottom edge
  const ob = d.onboard;
  if (ob) {
    for (const c of ob.carbs || []) { const t = Date.parse(c.t); if (t >= t0) { ctx.setFillColor(new Color(C.carb)); ctx.fillEllipse(new Rect(x(t) - 3.5, y1 - 8, 7, 7)); } }
    for (const q of ob.doses || []) { const t = Date.parse(q.t); if (t >= t0) { ctx.setFillColor(new Color(C.ins)); ctx.fillRect(new Rect(x(t) - 1.5, y1 - 14, 3, 12)); } }
  }
  // the readings
  readingLine(ctx, d, v.rs, t0, x, y, 2);
  ctx.setFillColor(new Color(v.stale ? C.text3 : C.dot[v.level]));
  ctx.fillEllipse(new Rect(x(v.last.t) - 5, y(v.last.v) - 5, 10, 10));
  return ctx.getImage();
}

// medium and large: the graph fills the widget. Her range, the readings as a thin line, doses and meals as lines with the amount,
// the latest value in a bubble at the last dot, and (when the link carries on-board data) a strip of what is acting now:
// food being absorbed above the line, insulin acting below. The strip is an estimate for display only: food follows
// the app's split (engine/absorb.ts: drinks quick, fatty meals with a slow part), insulin the same model as IOB.
// the food strip follows the app's rule (src/engine/absorb.ts): a curve peaking at 40 minutes, a drink at 12, and for
// a fatty meal a slow part peaking at 2 hours, its share fat ÷ 50 (none under 8 g, at most 60 %)
const rate = (m, tau) => (m > 0 ? (m / (tau * tau)) * Math.exp(-m / tau) * 60 : 0);
const slowShare = (fat) => (fat == null || !(Number(fat) >= 8) ? 0 : Math.min(0.6, Number(fat) / 50));

function graphFirst(d, v, size, top) {
  const ctx = new DrawContext();
  ctx.size = size;
  ctx.opaque = true;
  ctx.respectScreenScale = true;
  const W = size.width, H = size.height, ob = d.onboard;
  const lane = ob && ((ob.dia > 0 && ob.peak > 0 && ob.peak < ob.dia / 2 && (ob.doses || []).length) || (ob.carbs || []).length);
  const x0 = 12, x1 = W - (lane ? 46 : 12), y0 = top, y1 = H - (lane ? 46 : 20), lz = H - 28;
  ctx.setFillColor(new Color(C.bg));
  ctx.fillRect(new Rect(0, 0, W, H));
  const vals = v.rs.map((r) => r.v);
  const lo = Math.min(54, ...vals), hi = Math.max(200, ...vals);
  const y = (mg) => y1 - ((mg - lo) / (hi - lo)) * (y1 - y0);
  // the 2-hour mark after her last meal (carbs in the last 4 hours), the usual time to judge a meal: the graph then
  // runs 30 minutes ahead so the mark is seen coming
  const now = Date.now();
  const meal = ((ob && ob.carbs) || []).map((c) => Date.parse(c.t)).filter((t) => t <= now && now - t < 4 * 60 * MIN).sort((a, b) => a - b).pop();
  const ahead = meal ? 30 * MIN : 0;
  const t1 = now + ahead, t0 = t1 - 3 * 60 * MIN;
  const x = (t) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
  ctx.setFillColor(new Color(C.band));
  ctx.fillRect(new Rect(x0, y(d.high), x1 - x0, y(d.low) - y(d.high)));
  if (ahead) {
    ctx.setFillColor(new Color(C.border, 0.45)); // the next 30 minutes: no readings yet
    ctx.fillRect(new Rect(x(now), y0, x1 - x(now), y1 - y0));
    ctx.setFillColor(new Color(C.text3));
    ctx.fillRect(new Rect(x(now) - 0.5, y0, 1, y1 - y0));
  }
  // hour lines; their labels along the bottom, "now" at the right
  ctx.setFont(Font.mediumSystemFont(9));
  ctx.setTextColor(new Color(C.text3));
  for (let h = new Date(t0).setMinutes(0, 0, 0) + 60 * MIN; h < t1; h += 60 * MIN) {
    const px = x(h);
    ctx.setFillColor(new Color(C.border));
    ctx.fillRect(new Rect(px - 0.5, y0, 1, y1 - y0));
    ctx.setTextAlignedCenter();
    if (px - 16 >= 0 && px + 40 <= x1 && (!ahead || Math.abs(px - x(now)) > 34)) ctx.drawTextInRect(hhmm(h), new Rect(px - 20, H - 13, 40, 12));
  }
  if (ahead) { ctx.setTextAlignedCenter(); ctx.drawTextInRect(WORDS2.now, new Rect(x(now) - 30, H - 13, 60, 12)); }
  else { ctx.setTextAlignedRight(); ctx.drawTextInRect(WORDS2.now, new Rect(x1 - 60, H - 13, 60, 12)); }
  // doses and meals: a faint line with the amount at the top
  ctx.setFont(Font.boldSystemFont(9));
  const mark = (t, color, label, right) => {
    if (t < t0 || t > t1) return;
    const px = x(t);
    ctx.setFillColor(new Color(color, 0.35));
    ctx.fillRect(new Rect(px - 1, y0, 2, y1 - y0));
    ctx.setTextColor(new Color(color));
    if (right) { ctx.setTextAlignedLeft(); ctx.drawTextInRect(label, new Rect(px + 3, y0, 40, 12)); }
    else { ctx.setTextAlignedRight(); ctx.drawTextInRect(label, new Rect(px - 43, y0, 40, 12)); }
  };
  for (const q of (ob && ob.doses) || []) mark(Date.parse(q.t), C.ins, Number(q.u).toFixed(1).replace(/\.0$/, "") + "u", false);
  for (const c of (ob && ob.carbs) || []) mark(Date.parse(c.t), C.carb, Math.round(Number(c.g)) + "g", true);
  if (meal) {
    // purple and dashed while waiting, green once the 2 hours have passed
    const at = meal + 120 * MIN, done = now >= at, px = x(at), tone2 = done ? "#1F9D6B" : "#7A6BD8";
    ctx.setFillColor(new Color(tone2));
    if (done) ctx.fillRect(new Rect(px - 0.8, y0, 1.6, y1 - y0));
    else for (let yy = y0; yy < y1; yy += 6) ctx.fillRect(new Rect(px - 0.8, yy, 1.6, Math.min(3, y1 - yy)));
    const pill = new Path();
    pill.addRoundedRect(new Rect(px - 17, y1 - 15, 34, 15), 7.5, 7.5);
    ctx.addPath(pill);
    ctx.fillPath();
    ctx.setFont(Font.boldSystemFont(9.5));
    ctx.setTextColor(new Color("#ffffff"));
    ctx.setTextAlignedCenter();
    ctx.drawTextInRect(done ? "2h ✓" : "2h", new Rect(px - 17, y1 - 13.5, 34, 13));
  }
  // the readings
  readingLine(ctx, d, v.rs, t0, x, y, 1.8);
  const lx = x(v.last.t), ly = y(v.last.v), tone = v.stale ? C.text3 : C.text[v.level];
  ctx.setFillColor(new Color("#ffffff"));
  ctx.fillEllipse(new Rect(lx - 6.5, ly - 6.5, 13, 13));
  ctx.setFillColor(new Color(v.stale ? C.text3 : C.dot[v.level]));
  ctx.fillEllipse(new Rect(lx - 5, ly - 5, 10, 10));
  // the bubble: below the last dot when there is room, else above; kept inside the graph
  const bw = W > 340 ? 76 : 68, bh = 26;
  const bx = Math.max(x0, Math.min(lx - bw + 14, x1 - bw));
  const by = ly + 10 + bh <= y1 + 4 ? ly + 10 : ly - 10 - bh;
  const bubble = new Path();
  bubble.addRoundedRect(new Rect(bx, by, bw, bh), 9, 9);
  ctx.addPath(bubble);
  ctx.setFillColor(new Color(tone));
  ctx.fillPath();
  ctx.setFont(Font.boldRoundedSystemFont(17));
  ctx.setTextColor(new Color("#ffffff"));
  ctx.setTextAlignedCenter();
  ctx.drawTextInRect(v.value + (v.arrow ? " " + v.arrow : ""), new Rect(bx, by + 3, bw, bh - 4));
  if (lane) {
    // what is acting now, the last 3 hours: food (g/h) up, insulin (U/h) down
    const step = 3 * MIN, pts = [];
    const tau = ob.dia > 0 && ob.peak > 0 && ob.peak < ob.dia / 2 ? (ob.peak * (1 - ob.peak / ob.dia)) / (1 - (2 * ob.peak) / ob.dia) : null;
    const a = tau ? (2 * tau) / ob.dia : 0, S = tau ? 1 / (1 - a + (1 + a) * Math.exp(-ob.dia / tau)) : 0;
    for (let t = t0; t <= now; t += step) {
      let food = 0, slow = 0, ins = 0;
      for (const c of ob.carbs || []) {
        const m = (t - Date.parse(c.t)) / MIN, g = Number(c.g);
        if (!(m > 0 && m < 720)) continue;
        if (c.d) { food += g * rate(m, 12); continue; }
        const sh = slowShare(c.f);
        food += g * (1 - sh) * rate(m, 40); slow += g * sh * rate(m, 120);
      }
      if (tau) for (const q of ob.doses || []) { const m = (t - Date.parse(q.t)) / MIN; if (m > 0 && m < ob.dia) ins += Number(q.u) * (S / (tau * tau)) * m * (1 - m / ob.dia) * Math.exp(-m / tau) * 60; }
      pts.push([x(t), food + slow, ins, slow]);
    }
    const area = (f, color) => {
      const p = new Path();
      p.move(new Point(pts[0][0], lz));
      for (const q of pts) p.addLine(new Point(q[0], f(q)));
      p.addLine(new Point(pts[pts.length - 1][0], lz));
      p.closeSubpath();
      ctx.addPath(p);
      ctx.setFillColor(new Color(color));
      ctx.fillPath();
    };
    area((q) => lz - Math.min(q[1] / 30, 1) * 12, "#FFCF94");
    area((q) => lz - Math.min(q[3] / 30, 1) * 12, "#E8892B"); // the slow part of a fatty meal, darker
    area((q) => lz + Math.min(q[2] / 1.2, 1) * 12, "#5F97FF");
    ctx.setFillColor(new Color("#CFD3FF"));
    ctx.fillRect(new Rect(x0, lz - 0.5, x(now) - x0, 1));
    ctx.setFont(Font.mediumSystemFont(8));
    ctx.setTextAlignedLeft();
    ctx.setTextColor(new Color("#C9771A"));
    ctx.drawTextInRect(WORDS2.food, new Rect(x1 + 4, lz - 13, 40, 11));
    ctx.setTextColor(new Color(C.ins));
    ctx.drawTextInRect(WORDS2.insulin, new Rect(x1 + 4, lz + 2, 40, 11));
  }
  return ctx.getImage();
}

async function logo() {
  const fm = FileManager.local();
  const p = fm.joinPath(fm.cacheDirectory(), "layan-logo.png");
  if (fm.fileExists(p)) return fm.readImage(p);
  try { const img = await new Request(APP + "icons/apple-touch-icon.png").loadImage(); fm.writeImage(p, img); return img; } catch (e) { return null; }
}

// the lock screen draws widgets in one tint and turns dark colours nearly transparent: text there is white
let LOCK = false;

function text(stack, s, size, opts) {
  const o = opts || {};
  const t = stack.addText(s);
  t.font = o.bold ? Font.boldRoundedSystemFont(size) : o.medium ? Font.mediumSystemFont(size) : Font.systemFont(size);
  t.textColor = new Color(LOCK ? "#ffffff" : o.color || C.ink);
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  return t;
}

function symbol(stack, name, color, size) {
  const s = SFSymbol.named(name);
  if (!s) return;
  const img = stack.addImage(s.image);
  img.tintColor = new Color(color);
  img.imageSize = new Size(size, size);
}

function message(w, s) {
  w.backgroundColor = new Color(C.bg);
  w.setPadding(12, 14, 12, 14);
  text(w, W.child, 14, { bold: true, color: C.brand });
  w.addSpacer(6);
  text(w, s, 12, { color: C.text2 }).lineLimit = 3;
}

// header: her picture and name on the left; insulin and carbs on board and the reading's age on the right
async function header(row, v, name, pic) {
  const img = await logo();
  if (img) { const i = row.addImage(img); i.imageSize = new Size(pic, pic); i.cornerRadius = pic * 0.26; row.addSpacer(6); }
  text(row, name, 13, { bold: true, color: C.brand });
  row.addSpacer();
  if (v.stale) { text(row, W.old + " · ", 11.5, { bold: true, color: C.text["low"] }); }
  if (v.onboard) {
    if (v.onboard.iob) { symbol(row, "syringe.fill", C.ins, 10); row.addSpacer(2); text(row, v.onboard.iob, 11.5, { medium: true, color: C.ins }); row.addSpacer(6); }
    if (v.onboard.cob) { symbol(row, "fork.knife", C.carb, 10); row.addSpacer(2); text(row, v.onboard.cob, 11.5, { medium: true, color: C.carb }); row.addSpacer(6); }
  }
  liveAge(row, v.last.t, 11.5, { bold: true, color: C.ink, right: true });
}

// How old the reading is, as a timer counting up by itself ("9:57" then "قبل"/"ago"): iOS redraws it on its own,
// so it stays true while iOS holds the widget back (it decides when widgets refresh, often every 10–30 minutes).
// Nothing else can change between refreshes, which is why the age is the thing that stands out.
function liveAge(stack, t, size, opts) {
  const o = opts || {};
  const color = new Color(LOCK ? "#ffffff" : o.color || C.ink);
  const r = stack.addStack();
  r.centerAlignContent();
  const d = r.addDate(new Date(t));
  d.applyTimerStyle();
  d.font = o.bold ? Font.boldSystemFont(size) : o.medium ? Font.mediumSystemFont(size) : Font.systemFont(size);
  d.textColor = color;
  d.lineLimit = 1;
  d.minimumScaleFactor = 0.6;
  if (o.right) d.rightAlignText(); // a timer takes the whole width it is given: keep its digits next to "ago"
  text(r, " " + W.agoWord, size, o);
  return r;
}

const d = await load();
const fam = config.widgetFamily || "medium";
LOCK = fam.startsWith("accessory");
const w = new ListWidget();
// a tap runs this script again in Scriptable: the latest reading in a couple of seconds (iOS has no refresh button for
// Scriptable widgets; the app itself opens from its own icon)
w.url = "scriptable:///run/" + encodeURIComponent(Script.name());
// a request only: iOS decides when a widget really refreshes (the reading's age below keeps counting meanwhile)
w.refreshAfterDate = new Date(Date.now() + 3 * MIN);
const v = d && !d.error ? view(d) : null;
const name = (d && d.child) || W.child;

if (fam === "accessoryInline") {
  text(w, v ? name + " " + v.value + " " + v.arrow + " · " + v.age : name + " —", 12);
} else if (fam === "accessoryCircular") {
  w.addAccessoryWidgetBackground = true;
  const ob = v && v.onboard;
  if (ob && (ob.iob || ob.cob)) {
    // a small circle: the value and arrow on one line, then insulin and carbs on board, each on its own line
    text(w, v.value + (v.arrow ? " " + v.arrow : ""), 15, { bold: true }).centerAlignText();
    for (const [icon, val] of [["syringe.fill", ob.iob], ["fork.knife", ob.cob]]) {
      if (!val) continue;
      const r = w.addStack();
      r.centerAlignContent();
      r.addSpacer(); symbol(r, icon, "#ffffff", 9); r.addSpacer(2); text(r, val, 10, { medium: true }); r.addSpacer();
    }
  } else {
    text(w, v ? v.value : "—", 18, { bold: true }).centerAlignText();
    text(w, v ? v.arrow || v.age : "", 11).centerAlignText();
  }
} else if (fam === "accessoryRectangular") {
  text(w, v ? v.value + " " + v.arrow : name + " —", 22, { bold: true });
  if (v) { const r = w.addStack(); r.centerAlignContent(); liveAge(r, v.last.t, 11); if (!v.stale) text(r, " · " + v.word, 11); }
  else text(w, d && d.error === "invalid" ? W.expired : W.noReading, 11);
  if (v && v.onboard) text(w, v.onboard.line, 11, { medium: true });
} else if (!d || d.error === "invalid") message(w, W.revoked);
else if (d.error) message(w, W.offline);
else if (!v) message(w, W.none);
else {
  const size = widgetSize(fam);
  w.setPadding(0, 0, 0, 0);
  if (fam === "small") {
    // small: picture, value and arrow on top; the trend fills the lower half
    w.backgroundImage = background(d, v, size, size.height * 0.5);
    w.setPadding(10, 12, 0, 12);
    const top = w.addStack();
    top.centerAlignContent();
    const img = await logo();
    if (img) { const i = top.addImage(img); i.imageSize = new Size(26, 26); i.cornerRadius = 7; top.addSpacer(6); }
    text(top, v.value, 30, { bold: true, color: v.color });
    top.addSpacer(3);
    text(top, v.arrow, 20, { bold: true, color: v.color });
    const ar = w.addStack(); ar.centerAlignContent();
    const ac = v.stale ? C.text["low"] : C.text2;
    if (v.stale) text(ar, W.old + " · ", 10, { color: ac });
    liveAge(ar, v.last.t, 10, { color: ac });
    if (v.onboard && v.onboard.iob) text(ar, " · IOB " + v.onboard.iob, 10, { color: ac });
    w.addSpacer();
  } else {
    // medium and large: a slim header; the graph, the value bubble and what is acting now fill the rest
    w.backgroundImage = graphFirst(d, v, size, fam === "large" ? 48 : 34);
    w.setPadding(8, 12, 0, 12);
    const row = w.addStack();
    row.centerAlignContent();
    await header(row, v, name, fam === "large" ? 26 : 22);
    if (d.offline) { const o = w.addStack(); o.addSpacer(); text(o, W.cached, 10, { color: C.text["high"] }); }
    w.addSpacer();
  }
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
