// app/api/newsletter/weekly/route.ts
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

type Bullet = { text: string; url?: string };
type SummaryFile = { generatedAt?: string; bullets?: Bullet[] };

const BTN_API = "https://api.buttondown.com/v1/emails";

async function readSummary(rel: string): Promise<SummaryFile | null> {
  const full = path.join(process.cwd(), "public", "data", "summaries", rel);
  try { return JSON.parse(await fs.readFile(full, "utf8")); } catch { return null; }
}

/** Schedule for Monday 09:00 London (or next Monday if we've passed it) */
function thisMonday0900LondonISO(now = new Date()): string {
  const nowLon = new Date(now.toLocaleString("en-GB", { timeZone: "Europe/London" }));
  const day = nowLon.getDay(); // 0=Sun..6=Sat
  const forwardToMon = (1 - day + 7) % 7;
  const targetLon = new Date(nowLon);
  targetLon.setDate(nowLon.getDate() + forwardToMon);
  targetLon.setHours(9, 0, 0, 0);
  if (targetLon.getTime() <= nowLon.getTime()) targetLon.setDate(targetLon.getDate() + 7);
  const targetUTC = new Date(targetLon.toLocaleString("en-GB", { timeZone: "UTC" }));
  return targetUTC.toISOString();
}

function renderSection(title: string, bullets: Bullet[]) {
  const items = bullets.slice(0, 10).map((b) => {
    const text = (b.text || "").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    const open = b.url ? `<a href="${b.url}" target="_blank" rel="noopener" style="text-decoration:none;color:#0a66c2">` : "";
    const close = b.url ? `</a>` : "";
    return `<li style="margin:0 0 10px 0;line-height:1.6">${open}${text}${close}</li>`;
  }).join("");
  return `
    <h2 style="margin:24px 0 12px 0;font-size:18px;color:#111">${title}</h2>
    <ul style="padding-left:18px;margin:0">${items}</ul>
  `;
}

function renderEmailHTML(weekLabel: string, hightech: Bullet[], telecoms: Bullet[]) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#ffffff">
  <div style="max-width:640px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
    <header style="margin-bottom:16px">
      <div style="font-weight:700;font-size:22px;line-height:1.2">Niv’s Tech and Telecom Pulse</div>
      <div style="color:#666;font-size:14px;margin-top:4px">Week of ${weekLabel}</div>
    </header>
    <p style="margin:0 0 12px 0;color:#444">My clean weekly takeaways from High Tech and Telecoms—10 bullets each, links included.</p>
    ${hightech.length ? renderSection("High Tech — Top 10", hightech) : ""}
    ${telecoms.length ? renderSection("Telecoms — Top 10", telecoms) : ""}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
    <p style="font-size:12px;color:#777;margin:0">You subscribed at nivstechpulse.com. Unsubscribe anytime via the link below.</p>
  </div>
</body></html>`;
}

async function composeAndSchedule() {
  const apiKey = process.env.BUTTONDOWN_API_KEY;
  if (!apiKey) return NextResponse.json({ ok:false, error:"Missing BUTTONDOWN_API_KEY" }, { status:500 });

  const [ht, tc] = await Promise.all([readSummary("hightech.json"), readSummary("telecoms.json")]);
  const hightech = ht?.bullets ?? [];
  const telecoms = tc?.bullets ?? [];

  if (!hightech.length && !telecoms.length)
    return NextResponse.json({ ok:false, error:"No bullets available" }, { status:400 });

  const weekLabel = new Date().toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
  const subject = `Niv’s Tech and Telecom Pulse — Week of ${weekLabel}`;
  const html = renderEmailHTML(weekLabel, hightech, telecoms);
  const publishISO = thisMonday0900LondonISO();

  const r = await fetch(BTN_API, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
      // Optional: ensure no duplicates if cron retries
      "X-Idempotency-Key": `weekly-${publishISO}`
    },
    body: JSON.stringify({
      subject,
      body: html,
      email_type: "public",
      status: "scheduled",
      publish_date: publishISO
    })
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ ok:false, error:"Buttondown API", detail:data }, { status:500 });

  return NextResponse.json({ ok:true, scheduledFor: publishISO, id: data.id ?? null });
}

export async function POST() {
  return composeAndSchedule();
}

// 🔑 This is what makes Vercel Cron work:
export async function GET() {
  return composeAndSchedule();
}
