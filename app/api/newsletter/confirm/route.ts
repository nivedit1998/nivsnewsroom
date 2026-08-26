// app/api/newsletter/confirm/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPublicSiteUrl } from "@/lib/siteUrl";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/?sub=missing", getPublicSiteUrl(req)));
  }

  const { data, error } = await supabaseAdmin
    .from("subscribers")
    .update({ status: "active", confirmed_at: new Date().toISOString() })
    .eq("token", token)
    .select("email")
    .single();

  if (error || !data?.email) {
    return NextResponse.redirect(new URL("/?sub=invalid", getPublicSiteUrl(req)));
  }

  return NextResponse.redirect(new URL("/?sub=confirmed", getPublicSiteUrl(req)));
}
