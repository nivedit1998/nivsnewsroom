// lib/ses.ts
import {
  SESv2Client,
  SendEmailCommand,
  SendBulkEmailCommand,
} from "@aws-sdk/client-sesv2";

const region = process.env.AWS_REGION!;
export const ses = new SESv2Client({ region });

type Recipient = { email: string };

/**
 * Single email (used for subscribe-confirm, etc.).
 * Note: SESv2 Simple content does not accept custom headers.
 * If you ever need custom headers here, switch to Raw content.
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
 * We use per-recipient ReplacementHeaders to add List-Unsubscribe.
 * (If your SDK/region doesn’t support ReplacementHeaders yet, tell me and I’ll switch to Raw MIME.)
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
  renderFor: (r: Recipient) => { html: string; text?: string; listUnsubUrl: string };
  from?: string;
  replyTo?: string;
}) {
  const BulkEmailEntries = recipients.map((r) => {
    const { html, text, listUnsubUrl } = renderFor(r);
    return {
      Destination: { ToAddresses: [r.email] },
      ReplacementEmailContent: {
        // Inline "template-like" payload; we’re not using stored templates.
        ReplacementTemplate: {
          ReplacementTemplateData: JSON.stringify({}),
          ReplacementTemplate: {
            TemplateContent: {
              Subject: { Data: subject },
              Html: { Data: html },
              Text: text ? { Data: text } : undefined,
            },
          },
        },
      },
      // Per-recipient headers (List-Unsubscribe & One-Click)
      // If this throws in your region/SDK, ping me and I’ll swap to Raw MIME.
      ReplacementHeaders: [
        { Name: "List-Unsubscribe", Value: `<${listUnsubUrl}>` },
        { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
      ],
    };
  });

  const cmd = new SendBulkEmailCommand({
    FromEmailAddress: from,
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    // Default content is ignored since we provide ReplacementTemplate above.
    // Some SDKs still require a shape here:
    DefaultContent: { Template: { TemplateName: "inline" } },
    BulkEmailEntries,
    DefaultEmailTags: [{ Name: "stream", Value: "broadcast" }],
  });

  return ses.send(cmd);
}
