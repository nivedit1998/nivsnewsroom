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
  const tab = (url.searchParams.get("tab") || "").toLowerCase(); // "hightech" | "telecoms" | "company"
  const company = (url.searchParams.get("company") || "").toLowerCase(); // "microsoft" | "sage"

  let rel = "";
  if (tab === "hightech") rel = "hightech.json";
  else if (tab === "telecoms") rel = "telecoms.json";
  else if (tab === "company" && (company === "microsoft" || company === "sage")) {
    rel = `company_${company}.json`;
  } else {
    return NextResponse.json({ error: "invalid tab/company" }, { status: 400 });
  }

  const data = await readSummary(rel);
  if (!data) return NextResponse.json({ bullets: [], note: "no summary yet" });

  return NextResponse.json(data);
}
