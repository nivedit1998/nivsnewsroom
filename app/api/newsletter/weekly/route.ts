// app/api/newsletter/weekly/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendBulk } from "@/lib/ses";

/* ---------------- Types ---------------- */
type Bullet = { text: string; url?: string };
type SummaryFile = { generatedAt?: string; bullets?: Bullet[] };

/* -------------- Summary loaders (keep your formats) -------------- */
/** Reads a JSON file under /public/data/summaries. Supports .json OR .jason (your current hightech filename). */
async function readSummaryBase(nameNoExt: string): Promise<SummaryFile | null> {
  const base = path.join(process.cwd(), "public", "data", "summaries");
  const tryPaths = [
    path.join(base, `${nameNoExt}.json`),
    path.join(base, `${nameNoExt}.jason`), // tolerate the .jason file you mentioned
  ];
  for (const p of tryPaths) {
    try {
      const raw = await fs.readFile(p, "utf8");
      return JSON.parse(raw);
    } catch {}
  }
  return null;
}

async function readHighTech(): Promise<Bullet[]> {
  const s = await readSummaryBase("hightech");
  return s?.bullets ?? [];
}
async function readTelecoms(): Promise<Bullet[]> {
  const s = await readSummaryBase("telecoms");
  return s?.bullets ?? [];
}

/* ---------------------- TZ + date helpers ---------------------- */
function fmtParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second),
  };
}
function getWeekday(date: Date, timeZone: string): number {
  const s = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(s);
}
function getTimeZoneOffset(date: Date, timeZone: string): number {
  const p = fmtParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUTC - date.getTime()) / 60000;
}
function makeZonedDate(
  year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone: string
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const guess = new Date(utcGuess);
  const offsetMin = getTimeZoneOffset(guess, timeZone);
  return new Date(utcGuess - offsetMin * 60000);
}
function mondayOfThisWeekLondon(d: Date) {
  const tz = "Europe/London";
  const p = fmtParts(d, tz);
  const weekday = getWeekday(d, tz);
  const dayStart = makeZonedDate(p.year, p.month, p.day, 0, 0, 0, tz);
  const diffToMonday = ((weekday + 6) % 7);
  return new Date(dayStart.getTime() - diffToMonday * 86400000);
}
function lastWeekRangeLondon(reference: Date = new Date()) {
  const thisMonday = mondayOfThisWeekLondon(reference);
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86400000);
  const lastSunday = new Date(lastMonday.getTime() + 6 * 86400000);
  return { start: lastMonday, end: lastSunday };
}
function formatDayMonthYear(d: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "2-digit", month: "short", year: "numeric",
  }).format(d);
}
function formatWeekRangeLabel(start: Date, end: Date) {
  const startStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "2-digit", month: "short",
  }).format(start);
  const endStr = formatDayMonthYear(end);
  return `${startStr}–${endStr}`;
}

/* ----------------- Rendering (keep your style) ----------------- */
function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stripUrls(s: string) {
  return s.replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "").trim();
}
function escWithBold(text: string) {
  const escaped = esc(text);
  return escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

function renderSection(title: string, bullets: Bullet[]) {
  const items = bullets.slice(0, 5).map((b) => {
    const clean = escWithBold(stripUrls(b.text || ""));
    return `<li style="margin:0 0 12px 0;line-height:1.7;color:#111">${clean}</li>`;
  }).join("");
  return `
    <h2 style="margin:24px 0 12px 0;font-size:18px;color:#111;font-weight:700">${esc(title)}</h2>
    <ul style="padding-left:18px;margin:0">${items}</ul>
  `;
}

function renderEmailHTML(weekLabel: string, hightech: Bullet[], telecoms: Bullet[], subscribeUrl: string, unsubscribeUrl: string) {
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
              <p style="margin:0 0 12px 0">
                A crisp weekly read. Here are the <strong>Top 5</strong> from <strong>High Tech</strong> and <strong>Telecoms</strong>.
              </p>
            </div>
          </td>
        </tr>

        ${hightech.length ? `
        <tr><td style="padding:0 24px 8px 24px;color:#111">
          ${renderSection("High Tech — Top 5", hightech)}
        </td></tr>` : ""}

        ${telecoms.length ? `
        <tr><td style="padding:0 24px 8px 24px;color:#111">
          ${renderSection("Telecoms — Top 5", telecoms)}
        </td></tr>` : ""}

        <tr><td style="padding:8px 24px 0 24px"><hr style="border:none;border-top:1px solid #eee;margin:0" /></td></tr>

        <tr>
          <td style="padding:16px 24px 8px 24px">
            <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
              <a href="https://nivstechpulse.com/?utm_source=newsletter&utm_medium=email&utm_campaign=weekly"
                 target="_blank" rel="noopener"
                 style="display:inline-block;padding:10px 14px;border:1px solid #111;border-radius:8px;text-decoration:none;color:#111 !important;font-weight:600;">
                <span style="color:#111 !important;">Read more at nivstechpulse.com →</span>
              </a>
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:0 24px 20px 24px">
            <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#777;font-size:12px;line-height:1.6">
              <p style="margin:12px 0 0 0">
                <a href="${subscribeUrl}" style="color:#0d6efd;text-decoration:underline">Subscribe</a>
                &nbsp;•&nbsp;
                <a href="${unsubscribeUrl}" style="color:#0d6efd;text-decoration:underline">Unsubscribe</a>
              </p>
              <p style="margin:6px 0 0 0">You subscribed at nivstechpulse.com. Unsubscribe any time.</p>
            </div>
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`;
}

/* ----------------------- Main send (SES) ----------------------- */
function buildSubject(): string {
  const { start, end } = lastWeekRangeLondon(new Date());
  const rangeLabel = formatWeekRangeLabel(start, end);
  return `Nivs Tech Pulse - Last Week's Top 5 News Summary (${rangeLabel})`;
}

function escapeText(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export async function GET() {
  try {
    // Load bullets
    const [hightech, telecoms] = await Promise.all([readHighTech(), readTelecoms()]);
    if (!hightech.length && !telecoms.length) {
      return NextResponse.json({ error: "No bullets available" }, { status: 400 });
    }

    // Subscribers
    const { data: subs, error } = await supabaseAdmin
      .from("subscribers")
      .select("email")
      .eq("status", "active");
    if (error) throw error;
    if (!subs?.length) {
      return NextResponse.json({ error: "No active subscribers" }, { status: 400 });
    }

    const { end: lastSun } = lastWeekRangeLondon(new Date());
    const weekLabel = formatDayMonthYear(lastSun);
    const subject = buildSubject();

    // Prepare per-recipient HTML/TEXT with one-click unsub
    await sendBulk({
      recipients: subs.map((s) => ({ email: s.email })),
      subject,
      renderFor: ({ email }) => {
        const subscribeUrl = `${process.env.PUBLIC_SITE_URL}/`;
        const unsubUrl = `${process.env.PUBLIC_SITE_URL}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}`;
        const html = renderEmailHTML(weekLabel, hightech, telecoms, subscribeUrl, unsubUrl);
        const text =
          `Niv’s Tech and Telecom Pulse — Week of ${weekLabel}\n\n` +
          `High Tech — Top 5\n` +
          hightech.slice(0, 5).map((b, i) => `${i + 1}. ${escapeText(b.text)}${b.url ? ` (${b.url})` : ""}`).join("\n") +
          `\n\nTelecoms — Top 5\n` +
          telecoms.slice(0, 5).map((b, i) => `${i + 1}. ${escapeText(b.text)}${b.url ? ` (${b.url})` : ""}`).join("\n") +
          `\n\nUnsubscribe: ${unsubUrl}`;

        return { html, text, listUnsubUrl: unsubUrl };
      },
    });

    return NextResponse.json({ ok: true, sent: subs.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to send" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET();
}
