// lib/ses.ts
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const region = process.env.AWS_REGION!;
export const ses = new SESv2Client({ region });

type Recipient = { email: string };

/**
 * Single email (used for subscribe-confirm, etc.)
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  from = process.env.SES_FROM!,
  replyTo = process.env.SES_REPLY_TO,
}: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
}) {
  const cmd = new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: html },
          Text: text ? { Data: text } : undefined,
        },
      },
    },
    EmailTags: [{ Name: "stream", Value: "broadcast" }],
  });

  return ses.send(cmd);
}

/**
 * Bulk send for the weekly newsletter.
 * NOTE: We intentionally send one-by-one with SendEmail (no SES stored templates).
 * This works in sandbox & production and avoids the "default template data" error.
 */
export async function sendBulk({
  recipients,
  subject,
  renderFor,
  from = process.env.SES_FROM!,
  replyTo = process.env.SES_REPLY_TO,
}: {
  recipients: Recipient[];
  subject: string;
  renderFor: (r: Recipient) => { html: string; text?: string };
  from?: string;
  replyTo?: string;
}) {
  const sends = recipients.map(async (r) => {
    const { html, text } = renderFor(r);
    return sendEmail({ to: r.email, subject, html, text, from, replyTo });
  });

  const results = await Promise.allSettled(sends);
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const failed = results
    .map((r) => (r.status === "rejected" ? (r.reason?.message || String(r.reason)) : null))
    .filter(Boolean) as string[];

  return { ok, failed };
}
