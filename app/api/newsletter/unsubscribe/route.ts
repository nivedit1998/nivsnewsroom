// app/api/newsletter/unsubscribe/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  if (!email) {
    return NextResponse.redirect(new URL("/?unsub=missing", process.env.PUBLIC_SITE_URL));
  }

  await supabaseAdmin
    .from("subscribers")
    .update({ status: "unsub", unsubscribed_at: new Date().toISOString() })
    .eq("email", email);

  return NextResponse.redirect(new URL("/?unsub=ok", process.env.PUBLIC_SITE_URL));
}
