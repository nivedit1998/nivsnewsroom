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

/** Next Monday 09:00 Europe/London (or today if it's Monday but before 09:00). Returns ISO Z. */
function nextMonday0900LondonISO(now: Date = new Date()): string {
  const tz = "Europe/London";
  const p = fmtParts(now, tz);
  const weekdayLon = getWeekday(now, tz); // 0..6 (Sun..Sat)

  // Base date in UTC corresponding to London local date (midnight)
  const baseUTC = Date.UTC(p.year, p.month - 1, p.day);
  const base = new Date(baseUTC);

  // Days forward to Monday
  let addDays = (1 - weekdayLon + 7) % 7;

  // If it's Monday but already past 09:00 London, push a week
  if (addDays === 0) {
    const nineToday = makeZonedDate(p.year, p.month, p.day, 9, 0, 0, tz);
    if (now.getTime() >= nineToday.getTime()) addDays = 7;
  }

  // Target calendar date (UTC container), then construct a 09:00 London instant
  const targetBase = new Date(base);
  targetBase.setUTCDate(targetBase.getUTCDate() + addDays);

  const y = targetBase.getUTCFullYear();
  const m = targetBase.getUTCMonth() + 1;
  const d = targetBase.getUTCDate();

  const sendInstant = makeZonedDate(y, m, d, 9, 0, 0, tz);
  return sendInstant.toISOString();
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

/* ------------------------- Email rendering ------------------------- */

function anchorOpen(url?: string) {
  if (!url) return "";
  // Force black links across clients: color inherits from black parent + explicit black span
  return `<a href="${url}" target="_blank" rel="noopener"
    style="text-decoration:underline;color:inherit !important;">`;
}
function anchorClose(url?: string) {
  if (!url) return "";
  return `</a>`;
}

function renderSection(title: string, bullets: Bullet[]) {
  const items = bullets
    .slice(0, 5) // Top 5 only
    .map((b) => {
      const text = (b.text || "").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      const aOpen = anchorOpen(b.url);
      const aClose = anchorClose(b.url);
      // Wrap with span that forces black even when client tries to recolor links
      return `
        <li style="margin:0 0 12px 0;line-height:1.7">
          ${aOpen}<span style="color:#111 !important;">${text}</span>${aClose}
        </li>`;
    })
    .join("");
  return `
    <h2 style="margin:24px 0 12px 0;font-size:18px;color:#111;font-weight:700">${title}</h2>
    <ul style="padding-left:18px;margin:0">${items}</ul>
  `;
}

function renderEmailHTML(weekLabel: string, hightech: Bullet[], telecoms: Bullet[]) {
  // Preheader: improves inbox preview, hidden in body
  const preheader =
    "Top 5 from High Tech & Telecoms — concise, link-rich, and curated.";
  return `<!doctype html>
<html>
  <body link="#111111" vlink="#111111" alink="#111111" style="margin:0;padding:0;background:#f8f9fb">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
      ${preheader}
    </span>
    <div style="max-width:640px;margin:0 auto;padding:24px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border:1px solid #eee;border-radius:12px;overflow:hidden">
        <tr>
          <td style="padding:24px 24px 8px 24px">
            <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
              <div style="font-weight:800;font-size:22px;line-height:1.2">Niv’s Tech and Telecom Pulse</div>
              <div style="color:#555;font-size:14px;margin-top:4px">Week of ${weekLabel}</div>
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
              <p style="margin:12px 0 0 0">You subscribed at nivstechpulse.com. Unsubscribe any time via the link below.</p>
            </div>
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`;
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

  const weekLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  const subject = `Niv’s Tech and Telecom Pulse — Top 5 each (Week of ${weekLabel})`;
  const html = renderEmailHTML(weekLabel, hightech, telecoms);

  const publishISO = nextMonday0900LondonISO();

  const payload: any = {
    subject,
    body: html,
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
