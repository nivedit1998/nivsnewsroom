// app/api/newsletter/confirm/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/?sub=missing", process.env.PUBLIC_SITE_URL));
  }

  const { data, error } = await supabaseAdmin
    .from("subscribers")
    .update({ status: "active", confirmed_at: new Date().toISOString() })
    .eq("token", token)
    .select("email")
    .single();

  if (error || !data?.email) {
    return NextResponse.redirect(new URL("/?sub=invalid", process.env.PUBLIC_SITE_URL));
  }

  return NextResponse.redirect(new URL("/?sub=confirmed", process.env.PUBLIC_SITE_URL));
}
