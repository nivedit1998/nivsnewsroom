import type { Metadata } from "next";
import Link from "next/link";
import fs from "node:fs/promises";
import path from "node:path";
import CopyPostButton from "./CopyPostButton";

const SUMMARY_LIMIT = 5;

type SummaryBullet = {
  text?: string;
};

type SummaryFile = {
  bullets?: SummaryBullet[];
};

export const metadata: Metadata = {
  title: "LinkedIn Post | Niv’s Tech and Telecom Pulse",
  description: "The latest copy-ready LinkedIn post from Niv’s Tech and Telecom Pulse.",
  alternates: { canonical: "/linkedinPost" },
};

async function readSummary(fileName: string): Promise<SummaryFile> {
  try {
    const fullPath = path.join(process.cwd(), "public", "data", "summaries", fileName);
    return JSON.parse(await fs.readFile(fullPath, "utf8")) as SummaryFile;
  } catch {
    return { bullets: [] };
  }
}

function cleanBullet(text = "") {
  return text
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bulletLines(summary: SummaryFile) {
  return (summary.bullets || [])
    .slice(0, SUMMARY_LIMIT)
    .map((bullet) => cleanBullet(bullet.text))
    .filter(Boolean)
    .map((text) => `⭐️ ${text}`);
}

function buildLinkedInPost(telecoms: SummaryFile, highTech: SummaryFile) {
  return [
    "Another busy week in the world of connectivity and innovation - and as always, the insights come from my project: www.nivstechpulse.com 🌐",
    "It’s my AI + AWS powered site that refreshes daily to bring together the top Tech and Telecoms stories from trusted sources, so you can stay up to date in minutes ⏱️",
    "",
    "Here’s what stood out this week:",
    "",
    "📞 𝐓𝐞𝐥𝐞𝐜𝐨𝐦𝐬",
    ...bulletLines(telecoms),
    "",
    "💻 𝐇𝐢𝐠𝐡 𝐓𝐞𝐜𝐡",
    ...bulletLines(highTech),
    "",
    "📩 If you’d like these updates every Monday morning straight to your inbox, you can hit subscribe in the top right of the site.",
    "💬 Which of these trends do you think will shape the next few years the most?",
    "#Tech #Telecoms #Innovation #Digital #AI",
  ].join("\n");
}

export default async function LinkedInPostPage() {
  const [telecoms, highTech] = await Promise.all([
    readSummary("telecoms.json"),
    readSummary("hightech.json"),
  ]);
  const post = buildLinkedInPost(telecoms, highTech);

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-50 via-white to-fuchsia-50 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link href="/" className="text-sm font-medium text-sky-700 hover:underline">
            ← Back to Niv’s Tech and Telecom Pulse
          </Link>
          <CopyPostButton post={post} />
        </div>

        <section className="rounded-3xl border border-sky-100 bg-white/90 p-5 shadow-lg sm:p-8">
          <div className="mb-5 border-b border-gray-100 pb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-700">
              LinkedIn post
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
              This week’s Tech and Telecoms update
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              Copy-ready text generated from the latest published newsroom summaries.
            </p>
          </div>

          <pre className="whitespace-pre-wrap font-sans text-[15px] leading-7 text-gray-800">
            {post}
          </pre>
        </section>
      </div>
    </main>
  );
}
