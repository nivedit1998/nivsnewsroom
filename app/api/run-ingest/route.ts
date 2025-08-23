// Node runtime (not Edge)
export const runtime = "nodejs";
// Increase if feeds + extraction need more time
export const maxDuration = 120;

import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || "";
    if (!process.env.INGEST_TOKEN || token !== process.env.INGEST_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Import your ingestor
    const mod = await import("../../../scripts/ingest.mjs"); // <- path from /app/api/run-ingest/
    if (typeof (mod as any).runAll !== "function") {
      return NextResponse.json({ error: "runAll() not found" }, { status: 500 });
    }

    const startedAt = new Date().toISOString();
    await (mod as any).runAll();
    const finishedAt = new Date().toISOString();

    return NextResponse.json({ ok: true, startedAt, finishedAt });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: "Ingest failed", detail: String(e?.message || e) }, { status: 500 });
  }
}
