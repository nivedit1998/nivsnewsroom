/* scripts/preview-newsletter.mjs */
import fs from "node:fs/promises";
import path from "node:path";

/* ---------- Types (lightweight) ---------- */
/// JSDoc for editor hints:
/** @typedef {{ text: string, url?: string }} Bullet */
/** @typedef {{ title:string, source:string, url:string, publishedAt?:string, score?:number, groupSize?:number, tags?:string[] }} RankedItem */

/* ---------- Loaders (same folders you already use) ---------- */
async function readSummaryBase(nameNoExt) {
  const base = path.join(process.cwd(), "public", "data", "summaries");
  const tryPaths = [
    path.join(base, `${nameNoExt}.json`),
    path.join(base, `${nameNoExt}.jason`), // your tolerant alt
  ];
  for (const p of tryPaths) {
    try { return JSON.parse(await fs.readFile(p, "utf8")); } catch {}
  }
  return null;
}
async function readRankedBase(nameNoExt /* "hightech" | "telecoms" */) {
  const full = path.join(process.cwd(), "public", "data", `${nameNoExt}.json`);
  try {
    const arr = JSON.parse(await fs.readFile(full, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/* ---------- Pick Top 5 bullets aligned to ranking ---------- */
async function getTop5BulletsForTab(tab /* "hightech"|"telecoms" */) {
  /** @type {RankedItem[]} */
  const ranked = await readRankedBase(tab);
  const rankedTop = ranked.slice(0, 12); // buffer
  const rankedUrls = new Set(rankedTop.map(r => r.url).filter(Boolean));

  const summary = await readSummaryBase(tab);
  /** @type {Bullet[]} */
  const bullets = summary?.bullets ?? [];

  // 1) bullets that match a top ranked URL
  const matched = bullets.filter(b => b.url && rankedUrls.has(b.url)).slice(0, 5);

  // 2) top-up with remaining summary bullets
  let out = matched.slice();
  if (out.length < 5) {
    const remaining = bullets.filter(b => !out.includes(b));
    out = out.concat(remaining).slice(0, 5);
  }

  // 3) synthesize from ranked if still short
  if (out.length < 5) {
    const need = 5 - out.length;
    const synth = rankedTop
      .filter(r => !out.some(b => b.url && b.url === r.url))
      .slice(0, need)
      .map(r => ({ text: synthBulletFromRanked(r), url: r.url }));
    out = out.concat(synth);
  }
  return out.slice(0, 5);
}

function synthBulletFromRanked(r) {
  const lead = toLead(r.title, 5);
  const src = r.source ? ` (${r.source})` : "";
  return `**${lead}**${src} - ${r.title}`;
}
function toLead(s = "", max = 5) {
  const cleaned = String(s).replace(/[^\w\s\-&]/g, " ").replace(/\s+/g, " ").trim();
  const stop = new Set(["the","a","an","and","of","for","to","in","on","from","with","by","at","as","is","are","was","were","this","that","into","over","under","after","before"]);
  const words = cleaned.split(" ").filter(w => !stop.has(w.toLowerCase()));
  return words.slice(0, max).join(" ");
}

/* ---------- Date helpers (London) ---------- */
function fmtParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour12:false, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year:+map.year, month:+map.month, day:+map.day,
    hour:+map.hour, minute:+map.minute, second:+map.second,
  };
}
function getWeekday(date, timeZone) {
  const s = new Intl.DateTimeFormat("en-GB", { timeZone, weekday:"short" }).format(date);
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(s);
}
function getTimeZoneOffset(date, timeZone) {
  const p = fmtParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUTC - date.getTime()) / 60000;
}
function makeZonedDate(year, month, day, hour, minute, second, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const guess = new Date(utcGuess);
  const offsetMin = getTimeZoneOffset(guess, timeZone);
  return new Date(utcGuess - offsetMin * 60000);
}
function mondayOfThisWeekLondon(d) {
  const tz = "Europe/London";
  const p = fmtParts(d, tz);
  const weekday = getWeekday(d, tz);
  const dayStart = makeZonedDate(p.year, p.month, p.day, 0,0,0, tz);
  const diffToMonday = ((weekday + 6) % 7);
  return new Date(dayStart.getTime() - diffToMonday * 86400000);
}
function lastWeekRangeLondon(reference = new Date()) {
  const thisMonday = mondayOfThisWeekLondon(reference);
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86400000);
  const lastSunday = new Date(lastMonday.getTime() + 6 * 86400000);
  return { start: lastMonday, end: lastSunday };
}
function formatDayMonthYear(d) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone:"Europe/London", day:"2-digit", month:"short", year:"numeric",
  }).format(d);
}

/* ---------- Rendering (same style as route) ---------- */
function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function stripUrls(s) {
  return String(s).replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "").trim();
}
function escWithBold(text) {
  const escaped = esc(text);
  return escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}
function renderSection(title, bullets) {
  const items = bullets.slice(0, 5).map((b) => {
    const clean = escWithBold(stripUrls(b.text || ""));
    return `<li style="margin:0 0 12px 0;line-height:1.7;color:#111">${clean}</li>`;
  }).join("");
  return `
    <h2 style="margin:24px 0 12px 0;font-size:18px;color:#111;font-weight:700">${esc(title)}</h2>
    <ul style="padding-left:18px;margin:0">${items}</ul>
  `;
}
function renderEmailHTML(weekLabel, hightech, telecoms, unsubscribeUrl) {
  const preheader = "Top 5 from High Tech & Telecoms — concise and curated.";
  return `<!doctype html>
<html>
  <body link="#111111" vlink="#111111" alink="#111111" style="margin:0;padding:0;background:#f8f9fb">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
      ${esc(preheader)}
    </span>
    <div style="max-width:640px;margin:0 auto;padding:24px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border:1px solid #eee;border-radius:12px;overflow:hidden">
        <tr>
          <td style="padding:24px 24px 8px 24px">
            <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
              <div style="font-weight:800;font-size:22px;line-height:1.2">Niv’s Tech and Telecom Pulse</div>
              <div style="color:#555;font-size:14px;margin-top:4px">Week of ${esc(weekLabel)}</div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 8px 24px">
            <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:14px;line-height:1.8">
              <p style="margin:0 0 12px 0">A crisp weekly read. Here are the <strong>Top 5</strong> from <strong>High Tech</strong> and <strong>Telecoms</strong>.</p>
            </div>
          </td>
        </tr>
        ${hightech.length ? `<tr><td style="padding:0 24px 8px 24px;color:#111">${renderSection("High Tech — Top 5", hightech)}</td></tr>` : ""}
        ${telecoms.length ? `<tr><td style="padding:0 24px 8px 24px;color:#111">${renderSection("Telecoms — Top 5", telecoms)}</td></tr>` : ""}
        <tr><td style="padding:8px 24px 0 24px"><hr style="border:none;border-top:1px solid #eee;margin:0" /></td></tr>
        <tr>
          <td style="padding:16px 24px 8px 24px">
            <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
              <a href="https://nivstechpulse.com/?utm_source=newsletter&utm_medium=email&utm_campaign=weekly" target="_blank" rel="noopener" style="display:inline-block;padding:10px 14px;border:1px solid #111;border-radius:8px;text-decoration:none;color:#111 !important;font-weight:600;">
                <span style="color:#111 !important;">Read more at nivstechpulse.com →</span>
              </a>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 20px 24px">
            <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#777;font-size:12px;line-height:1.6">
              <p style="margin:6px 0 0 0">You subscribed at nivstechpulse.com. Unsubscribe any time.</p>
              <p style="margin:6px 0 0 0">Unsubscribe: <a href="${unsubscribeUrl}" style="color:#0d6efd;text-decoration:underline">${unsubscribeUrl}</a></p>
              <p style="margin:6px 0 0 0"><strong>Resubscribe at nivstechpulse.com</strong></p>
            </div>
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`;
}

/* ---------- Main: build HTML and write it to .preview/weekly.html ---------- */
async function main() {
  const [hightech, telecoms] = await Promise.all([
    getTop5BulletsForTab("hightech"),
    getTop5BulletsForTab("telecoms"),
  ]);

  const { end: lastSun } = lastWeekRangeLondon(new Date());
  const weekLabel = formatDayMonthYear(lastSun);

  const unsubscribeUrl = "https://nivstechpulse.com/unsubscribe?email=preview%40example.com"; // dummy
  const html = renderEmailHTML(weekLabel, hightech, telecoms, unsubscribeUrl);

  const outDir = path.join(process.cwd(), ".preview");
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "weekly.html");
  await fs.writeFile(outFile, html, "utf8");

  console.log(`\n✅ Preview written to: ${outFile}\nOpen it in your browser to review the email.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
