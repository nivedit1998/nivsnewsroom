/* app/api/weekly-summary/route.ts */
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

async function readSummary(rel: string) {
  const full = path.join(process.cwd(), "public", "data", "summaries", rel);
  try {
    const raw = await fs.readFile(full, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tab = (url.searchParams.get("tab") || "").toLowerCase(); // "hightech" | "fintech" | "telecoms" | "company"
  const company = (url.searchParams.get("company") || "").toLowerCase(); // "accenture" | "capco" | "sage"

  let rel = "";
  if (tab === "hightech") rel = "hightech.json";
  else if (tab === "fintech") rel = "fintech.json";
  else if (tab === "telecoms") rel = "telecoms.json";
  else if (tab === "company" && (company === "accenture" || company === "capco" || company === "sage")) {
    rel = `company_${company}.json`;
  } else {
    return NextResponse.json({ error: "invalid tab/company" }, { status: 400 });
  }

  const data = await readSummary(rel);
  if (!data) return NextResponse.json({ bullets: [], note: "no summary yet" });

  const bullets = Array.isArray(data?.bullets) ? data.bullets.slice(0, 5) : [];
  return NextResponse.json({ ...data, bullets });
}
