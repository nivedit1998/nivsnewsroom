// app/api/newsletter/subscribe/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { randomBytes } from "crypto";
import { sendEmail } from "@/lib/ses";
import { getPublicSiteUrl } from "@/lib/siteUrl";

function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const raw = String(body?.email || "");
    const email = raw.trim().toLowerCase();
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const token = randomBytes(24).toString("hex");

    const { error } = await supabaseAdmin
      .from("subscribers")
      .upsert({ email, token, status: "pending" }, { onConflict: "email" });
    if (error) throw error;

    const base = getPublicSiteUrl(req);
    const confirmUrl = `${base}/api/newsletter/confirm?token=${encodeURIComponent(token)}`;

    await sendEmail({
      to: email,
      subject: "Confirm your subscription — Niv’s Tech and Telecom Pulse",
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6">
          <p>Hi,</p>
          <p>Click the button to confirm your subscription:</p>
          <p><a href="${confirmUrl}" style="display:inline-block;padding:10px 14px;border:1px solid #111;border-radius:8px;text-decoration:none;color:#111 !important;font-weight:600;">Confirm subscription</a></p>
          <p>If you didn't request this, you can ignore this email.</p>
        </div>
      `,
      text: `Confirm your subscription: ${confirmUrl}`,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
