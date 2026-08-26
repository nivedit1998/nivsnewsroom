export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization");
  return Boolean(secret && authorization === `Bearer ${secret}`);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("system_heartbeat")
    .upsert(
      { id: "main", last_seen_at: now, source: "vercel-cron", updated_at: now },
      { onConflict: "id" }
    )
    .select("id,last_seen_at,source,updated_at")
    .single();

  if (error) {
    console.error("Supabase heartbeat failed", error);
    return NextResponse.json({ error: "Supabase heartbeat failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, heartbeat: data });
}
