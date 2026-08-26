// app/api/newsletter/unsubscribe/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPublicSiteUrl } from "@/lib/siteUrl";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("email");
  const email = (raw || "").trim().toLowerCase();
  if (!email) {
    return NextResponse.redirect(new URL("/?unsub=missing", getPublicSiteUrl(req)));
  }

  const { error } = await supabaseAdmin
    .from("subscribers")
    .update({ status: "unsub", unsubscribed_at: new Date().toISOString() })
    .eq("email", email);

  if (error) {
    console.error("Unsubscribe failed", error);
    return NextResponse.json({ error: "Unsubscribe failed" }, { status: 500 });
  }

  return NextResponse.redirect(new URL("/?unsub=ok", getPublicSiteUrl(req)));
}
