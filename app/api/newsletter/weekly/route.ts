// app/api/newsletter/weekly/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

type Bullet = { text: string; url?: string };
type SummaryFile = { generatedAt?: string; bullets?: Bullet[] };

// Buttondown API host
const BTN_API = "https://api.buttondown.email/v1/emails";

/* ---------------------- TZ helpers (no Luxon) ---------------------- */

function fmtParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function getWeekday(date: Date, timeZone: string): number {
  const s = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(s);
}

/** Offset in minutes for `timeZone` at the moment `date` represents. */
function getTimeZoneOffset(date: Date, timeZone: string): number {
  const p = fmtParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUTC - date.getTime()) / 60000;
}

/** Create a UTC Date that represents `timeZone` local Y-M-D h:m:s. */
function makeZonedDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const guess = new Date(utcGuess);
  const offsetMin = getTimeZoneOffset(guess, timeZone);
  return new Date(utcGuess - offsetMin * 60000);
}

/** Get "now" as a Date (UTC instant) but with London parts handy */
function nowLondon() {
  const tz = "Europe/London";
  const now = new Date();
  const p = fmtParts(now, tz);
  return { tz, now, parts: p, weekday: getWeekday(now, tz) }; // weekday: 0..6 (Sun..Sat)
}

/** Monday of the week containing 'd' in London local time */
function mondayOfThisWeekLondon(d: Date) {
  const tz = "Europe/London";
  const p = fmtParts(d, tz);
  const weekday = getWeekday(d, tz); // Sun=0 .. Sat=6
  // Build date at local midnight
  const dayStart = makeZonedDate(p.year, p.month, p.day, 0, 0, 0, tz);
  const diffToMonday = ((weekday + 6) % 7); // Mon=1 -> 0, Tue=2 -> 1, Sun=0 -> 6
  const monday = new Date(dayStart.getTime() - diffToMonday * 24 * 60 * 60 * 1000);
  return monday;
}

/** Previous week's Monday (start) and Sunday (end) in London */
function lastWeekRangeLondon(reference: Date = new Date()) {
  // Get Monday of current week, then subtract 7 days to get last Monday
  const thisMonday = mondayOfThisWeekLondon(reference);
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86400000);
  const lastSunday = new Date(lastMonday.getTime() + 6 * 86400000);
  return { start: lastMonday, end: lastSunday };
}

/** Format a date like "18 Aug 2025" (en-GB) */
function formatDayMonthYear(d: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Format a range like "18–24 Aug 2025" (en-GB) */
function formatWeekRangeLabel(start: Date, end: Date) {
  const startStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
  }).format(start);
  const endStr = formatDayMonthYear(end);
  return `${startStr}–${endStr}`;
}

/** Next Monday 10:00 Europe/London (returns ISO Z) */
function nextMonday1000LondonISO(now: Date = new Date()): string {
  const tz = "Europe/London";
  const p = fmtParts(now, tz);
  const weekdayLon = getWeekday(now, tz); // 0..6 (Sun..Sat)

  // Base date at London local midnight (as UTC instant)
  const baseUTC = Date.UTC(p.year, p.month - 1, p.day);
  const base = new Date(baseUTC);

  // Days forward to Monday (1)
  let addDays = (1 - weekdayLon + 7) % 7;
  if (addDays === 0) addDays = 7; // if today is Monday, move to next Monday

  const targetBase = new Date(base);
  targetBase.setUTCDate(targetBase.getUTCDate() + addDays);
  const y = targetBase.getUTCFullYear();
  const m = targetBase.getUTCMonth() + 1;
  const d = targetBase.getUTCDate();
  return makeZonedDate(y, m, d, 10, 0, 0, tz).toISOString();
}

/* --------------------------- File helpers -------------------------- */

async function readSummary(rel: string): Promise<SummaryFile | null> {
  const full = path.join(process.cwd(), "public", "data", "summaries", rel);
  try {
    return JSON.parse(await fs.readFile(full, "utf8"));
  } catch {
    return null;
  }
}

/* ------------------------- Sanitizers/helpers ---------------------- */

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Remove any explicit URLs from text (http(s)://..., or www.). */
function stripUrls(s: string) {
  return s.replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "").trim();
}

/** Escape, then allow **bold** via <strong>. */
function escWithBold(text: string) {
  const escaped = esc(text);
  return escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

/* ------------------------- Email rendering ------------------------- */

function renderSection(title: string, bullets: Bullet[]) {
  const items = bullets
    .slice(0, 5)
    .map((b) => {
      const clean = escWithBold(stripUrls(b.text || ""));
      return `
        <li style="margin:0 0 12px 0;line-height:1.7;color:#111">
          ${clean}
        </li>`;
    })
    .join("");
  return `
    <h2 style="margin:24px 0 12px 0;font-size:18px;color:#111;font-weight:700">${esc(title)}</h2>
    <ul style="padding-left:18px;margin:0">${items}</ul>
  `;
}

function renderEmailHTML(weekLabel: string, hightech: Bullet[], telecoms: Bullet[]) {
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
        <tr>
          <td style="padding:0 24px 8px 24px;color:#111">
            ${renderSection("High Tech — Top 5", hightech)}
          </td>
        </tr>` : ""}

        ${telecoms.length ? `
        <tr>
          <td style="padding:0 24px 8px 24px;color:#111">
            ${renderSection("Telecoms — Top 5", telecoms)}
          </td>
        </tr>` : ""}

        <tr>
          <td style="padding:8px 24px 0 24px">
            <hr style="border:none;border-top:1px solid #eee;margin:0" />
          </td>
        </tr>

        <!-- Only your site link -->
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
                <a href="{{ subscribe_url }}" style="color:#0d6efd;text-decoration:underline">Subscribe</a>
                &nbsp;•&nbsp;
                <a href="{{ unsubscribe_url }}" style="color:#0d6efd;text-decoration:underline">Unsubscribe</a>
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

/* ------------------ Scheduling helpers for your exact rule ------------------ */

/**
 * Decide publish time:
 * - If today is Monday (Europe/London):
 *    - schedule for 10:00 today if current time < 10:00
 *    - otherwise schedule ASAP (now + 2 minutes)
 * - Otherwise schedule for next Monday 10:00 London
 */
function decidePublishISO(): string {
  const { tz, now, parts, weekday } = nowLondon();

  // Monday?
  if (weekday === 1) {
    const tenToday = makeZonedDate(parts.year, parts.month, parts.day, 10, 0, 0, tz);
    if (now.getTime() < tenToday.getTime()) {
      return tenToday.toISOString();
    }
    // After 10:00 — send asap (pad 2 minutes for safety)
    return new Date(now.getTime() + 2 * 60 * 1000).toISOString();
  }

  // Not Monday — schedule next Monday 10:00
  return nextMonday1000LondonISO(now);
}

/** Subject uses "Last Week's ..." and includes last week's Mon–Sun range */
function buildSubject(): string {
  const { start, end } = lastWeekRangeLondon(new Date());
  const rangeLabel = formatWeekRangeLabel(start, end); // e.g., "18–24 Aug 2025"
  return `Nivs Tech Pulse - Last Week's Top 5 News Summary (${rangeLabel})`;
}

/* ------------------------- Main controller ------------------------- */

async function composeAndSchedule(mode: "scheduled" | "draft" = "scheduled") {
  const apiKey = process.env.BUTTONDOWN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing BUTTONDOWN_API_KEY" }, { status: 500 });
  }

  const [ht, tc] = await Promise.all([
    readSummary("hightech.json"),
    readSummary("telecoms.json"),
  ]);
  const hightech = ht?.bullets ?? [];
  const telecoms = tc?.bullets ?? [];

  if (!hightech.length && !telecoms.length) {
    return NextResponse.json({ ok: false, error: "No bullets available" }, { status: 400 });
  }

  // For the "Week of" line inside the email body, show the previous Sunday's date
  const { end: lastSun } = lastWeekRangeLondon(new Date());
  const weekLabel = formatDayMonthYear(lastSun);

  const subject = buildSubject();
  const html = renderEmailHTML(weekLabel, hightech, telecoms);

  // Decide publish time based on the rule you want
  const publishISO = decidePublishISO();

  const payload: any = {
    subject,
    body: html,              // HTML body with NO article links
    email_type: "public",
    status: mode === "draft" ? "draft" : "scheduled",
  };
  if (mode === "scheduled") payload.publish_date = publishISO;

  const r = await fetch(BTN_API, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": `weekly-${mode}-${payload.publish_date ?? weekLabel}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await r.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: "Buttondown API", detail: data },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    mode,
    scheduledFor: payload.publish_date ?? null,
    id: data.id ?? null,
  });
}

export async function GET(req: Request) {
  const mode = new URL(req.url).searchParams.get("mode") === "draft" ? "draft" : "scheduled";
  return composeAndSchedule(mode);
}

export async function POST(req: Request) {
  const mode = new URL(req.url).searchParams.get("mode") === "draft" ? "draft" : "scheduled";
  return composeAndSchedule(mode);
}
