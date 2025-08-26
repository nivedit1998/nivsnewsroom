/* app/page.tsx */
"use client";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Inter } from "next/font/google";
import SubscribeForm from "@/components/SubscribeForm";

const inter = Inter({ subsets: ["latin"], display: "swap" });

type Item = {
  title: string;
  source: string;
  url: string;
  publishedAt?: string;
  snippet?: string;
  excerpt?: string;
  fullText?: string;
  score?: number;
  groupSize?: number;
  tags?: string[];
};

type SummaryBullet = { text: string; url?: string } | string;

const TABS = ["Company Specific", "High Tech", "Telecoms"] as const;
type Tab = typeof TABS[number];

/** Replace **bold** markers with <strong> tags safely */
function renderWithBold(text: string) {
  const parts = text.split(/\*\*/g);
  return parts.map((seg, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-fuchsia-700">
        {seg}
      </strong>
    ) : (
      <span key={i}>{seg}</span>
    )
  );
}

function limitParagraphsByWords(paras: string[], maxWords: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const p of paras) {
    const words = p.trim().split(/\s+/);
    const remain = maxWords - used;
    if (remain <= 0) break;
    if (words.length <= remain) {
      out.push(p.trim());
      used += words.length;
    } else {
      out.push(words.slice(0, Math.max(1, remain)).join(" ") + "…");
      used = maxWords;
      break;
    }
  }
  return out;
}
function wordCount(s: string) {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export default function HomePage() {
  const [tab, setTab] = useState<Tab>("Telecoms");
  const [company, setCompany] = useState<"microsoft" | "sage">("microsoft");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [bullets, setBullets] = useState<Array<{ text: string; url?: string }>>([]);
  const [sumLoading, setSumLoading] = useState(false);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAllBullets, setShowAllBullets] = useState(false);
  const [showSubForm, setShowSubForm] = useState(false);

  const [pendingLoads, setPendingLoads] = useState(0);
  const isSwitching = pendingLoads > 0;

  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const doScroll = (top: number) => {
    try {
      window.scrollTo({ top, behavior: prefersReduced ? "auto" : ("smooth" as ScrollBehavior) });
    } catch {
      window.scrollTo(0, top);
    }
  };
  const scrollToAbsoluteTop = () => doScroll(0);
  const scrollToIdWithNavOffset = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const nav = document.getElementById("app-nav");
    const offset = (nav?.getBoundingClientRect().height ?? 64) + 8;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    doScroll(top);
  };

  const dataPath = useMemo(() => {
    if (tab === "High Tech") return "/data/hightech.json";
    if (tab === "Telecoms") return "/data/telecoms.json";
    return `/data/company/${company}.json`;
  }, [tab, company]);

  const summaryUrl = useMemo(() => {
    if (tab === "High Tech") return "/api/weekly-summary?tab=hightech";
    if (tab === "Telecoms") return "/api/weekly-summary?tab=telecoms";
    return `/api/weekly-summary?tab=company&company=${company}`;
  }, [tab, company]);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setPendingLoads((n) => n + 1);
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(dataPath, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const arr = Array.isArray(json) ? json : [];
        setItems(arr);
        setExpanded({});
      } catch (e: any) {
        if (e?.name !== "AbortError") setErr("Trying to load articles from last week");
      } finally {
        setLoading(false);
        setPendingLoads((n) => Math.max(0, n - 1));
      }
    })();
    return () => ctrl.abort();
  }, [dataPath]);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setPendingLoads((n) => n + 1);
      setSumLoading(true);
      try {
        const res = await fetch(summaryUrl, { cache: "no-store", signal: ctrl.signal });
        const json = await res.json().catch(() => ({}));
        const arr = Array.isArray(json?.bullets) ? json.bullets : [];
        const normalized = arr.map((b: any) =>
          typeof b === "string" ? { text: b } : { text: String(b.text || ""), url: b.url || undefined }
        );
        setBullets(normalized.slice(0, 10));
      } catch {} finally {
        setSumLoading(false);
        setPendingLoads((n) => Math.max(0, n - 1));
      }
    })();
    return () => ctrl.abort();
  }, [summaryUrl]);

  const title =
    tab === "High Tech"
      ? "My 10 key insights from High Tech this week"
      : tab === "Telecoms"
      ? "My 10 key insights from Telecoms this week"
      : `My 10 key insights from ${company[0].toUpperCase()}${company.slice(1)} this week`;

  const toggle = (key: string) => setExpanded((s) => ({ ...s, [key]: !s[key] }));

  const getParagraphs = (it: Item) => {
    const base = it.fullText?.trim() || it.excerpt?.trim() || it.snippet?.trim() || "";
    return base.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  };
  const getCollapsedParas = (it: Item) => limitParagraphsByWords(getParagraphs(it), 50);
  const getExpandedParas = (it: Item) => {
    const full = it.fullText?.trim() || it.excerpt?.trim() || it.snippet?.trim() || "";
    const total = wordCount(full);
    const budget = Math.max(80, Math.floor(total * 0.3));
    return limitParagraphsByWords(getParagraphs(it), budget);
  };

  const collapsedFadeStart = 4;
  const collapsedFadeEnd = 5;
  const showCollapsed = !showAllBullets;
  const visibleBullets = showAllBullets
    ? bullets
    : bullets.slice(0, Math.min(bullets.length, collapsedFadeEnd + 1));

  const pillBase = "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]";

  return (
    <div
      className={`${inter.className} min-h-screen bg-white text-gray-900 overflow-y-scroll`}
      style={{ scrollbarGutter: "stable both-edges", WebkitTapHighlightColor: "transparent" }}
    >
      {/* Fixed, always-visible navbar */}
      <nav
        id="app-nav"
        className="fixed inset-x-0 top-0 z-50 h-12 sm:h-16 border-b border-white/20 bg-white/60 backdrop-blur supports-[backdrop-filter]:bg-white/40"
      >
        <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-3 sm:px-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <Image
              src="/logo.png"
              alt="NivsTechPulse Logo"
              width={32}
              height={32}
              className="h-7 w-7 sm:h-8 sm:w-8 rounded-md"
              priority
            />
            <div className="leading-tight">
              <h1 className="text-base sm:text-lg font-bold tracking-tight">
                Niv’s <span className="text-sky-600">Tech</span> &{" "}
                <span className="text-fuchsia-700">Telecoms</span> Pulse
              </h1>
              <p className="hidden xs:block text-[10px] sm:text-[11px] text-gray-600 -mt-0.5">
                A weekly look — hottest topics first
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={scrollToAbsoluteTop}
              className="hidden sm:inline text-sm text-gray-700 hover:text-sky-700"
            >
              Summary
            </button>
            <button
              onClick={() => scrollToIdWithNavOffset("articles")}
              className="hidden sm:inline text-sm text-gray-700 hover:text-sky-700"
            >
              Articles
            </button>

            {/* Desktop inline subscribe form (replaces Buttondown) */}
            <div className="hidden sm:block rounded-xl border border-sky-200 bg-white/70 px-3 py-1.5 shadow-sm">
              <SubscribeForm variant="inline" />
            </div>

            {/* Mobile subscribe button (toggles slide-down panel) */}
            <button
              onClick={() => setShowSubForm((v) => !v)}
              className="sm:hidden rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-[13px] text-sky-700 shadow-sm hover:bg-sky-100 active:scale-[0.99]"
              aria-expanded={showSubForm}
              aria-controls="mobile-subscribe"
            >
              ✉️
            </button>
          </div>
        </div>
      </nav>

      {/* Spacer so fixed nav doesn't cover content (responsive height) */}
      <div aria-hidden className="h-12 sm:h-16" />
      {/* Extra spacer when the mobile subscribe panel is open */}
      {showSubForm && <div aria-hidden className="sm:hidden h-28" />}

      {/* Mobile subscribe slide-down panel */}
      <div
        id="mobile-subscribe"
        className={`sm:hidden fixed left-0 right-0 top-12 z-40 px-3 transition-all duration-200 ${
          showSubForm ? "opacity-100 pointer-events-auto translate-y-0" : "opacity-0 pointer-events-none -translate-y-1"
        }`}
      >
        <div className="mx-auto max-w-6xl rounded-xl border border-sky-200 bg-white/90 backdrop-blur px-3 py-3 shadow-lg">
          <SubscribeForm variant="panel" />
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={() => setShowSubForm(false)}
              className="text-[12px] text-gray-600 hover:text-gray-800"
              aria-label="Close subscribe panel"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* MOBILE utility bar: sticky tabs row (under nav) */}
      <div className="sticky top-12 z-40 border-b border-gray-200 bg-gray-50/80 backdrop-blur sm:static sm:top-auto">
        <div className="mx-auto max-w-6xl px-3 sm:px-4 py-2 sm:py-3 flex items-center gap-2 overflow-x-auto hide-scrollbar scroll-p-3 snap-x">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setShowAllBullets(false);
              }}
              className={`snap-start shrink-0 rounded-full px-3 py-1.5 text-sm transition ring-1 ${
                tab === t
                  ? "bg-sky-600 text-white ring-sky-700/30 shadow-sm"
                  : "bg-white text-gray-800 ring-gray-200 hover:bg-gray-50"
              }`}
            >
              {t}
            </button>
          ))}

          {tab === "Company Specific" && (
            <label className="ml-1 shrink-0 text-sm text-gray-700">
              Company:&nbsp;
              <select
                value={company}
                onChange={(e) => {
                  setCompany(e.target.value as any);
                  setShowAllBullets(false);
                }}
                className="rounded-lg border border-gray-300 bg-white px-2 py-1 shadow-sm"
              >
                <option value="microsoft">Microsoft</option>
                <option value="sage">Sage</option>
              </select>
            </label>
          )}
        </div>
      </div>

      {/* PART 1 — SUMMARY HERO */}
      <section id="summary" className="relative">
        <div className="absolute inset-0 bg-gradient-to-b from-fuchsia-50 via-white to-sky-50" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-3 sm:px-4 py-8 sm:py-10">
          <div className="rounded-3xl border border-fuchsia-200/70 bg-white/80 p-4 sm:p-6 shadow-lg ring-1 ring-white/60 backdrop-blur">
            <div className="flex items-center justify-between gap-3 sm:gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-fuchsia-600 px-2.5 py-1 text-[11px] sm:text-xs font-semibold text-white">
                  Weekly summary
                </span>
                <h2 className="text-lg sm:text-xl font-bold">{title}</h2>
              </div>
              <button
                onClick={() => scrollToIdWithNavOffset("articles")}
                className="group inline-flex items-center gap-1 text-sm text-gray-700 hover:text-sky-700"
                title="Scroll to articles"
              >
                Articles below
                <svg className="h-4 w-4 translate-y-[1px] transition group-hover:translate-y-[3px]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M10 15l-5-6h10l-5 6z" />
                </svg>
              </button>
            </div>

            <div className={`relative transition-opacity duration-200 ${isSwitching ? "opacity-60" : "opacity-100"}`}>
              {sumLoading && bullets.length === 0 && (
                <p className="mt-4 text-sm text-gray-500">Loading my notes…</p>
              )}

              {bullets.length > 0 && (
                <>
                  <ul className="mt-4 sm:mt-5 grid gap-3 sm:gap-4 grid-cols-1 landscape:grid-cols-2 sm:grid-cols-2">
                    {visibleBullets.map((b, i) => {
                      const clean = String((b as any).text || "").replace(/^•\s*/, "");
                      const url = (b as any).url as string | undefined;
                      const isFadedPreview =
                        !showAllBullets && i >= 4 && i <= 5;

                      return (
                        <li
                          key={i}
                          className={`relative rounded-2xl bg-white ring-1 ring-gray-200 shadow-sm transition hover:shadow-md p-3 sm:p-4 ${
                            isFadedPreview ? "opacity-60 max-h-36 overflow-hidden pointer-events-none" : ""
                          }`}
                        >
                          {url && (
                            <a
                              href={`${url}${url.includes("?") ? "&" : "?"}utm_source=site&utm_medium=weekly_summary`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`absolute right-3 top-3 ${"inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] bg-gray-100 text-gray-700 ring-1 ring-gray-200 hover:bg-gray-200"} ${
                                isFadedPreview ? "hidden" : ""
                              }`}
                            >
                              Learn →
                            </a>
                          )}
                          <p className={`text-[15px] leading-relaxed ${url ? "pr-20" : ""}`}>
                            <span className="font-extrabold text-fuchsia-700 mr-1">{i + 1}.</span>
                            {renderWithBold(clean)}
                          </p>
                          {isFadedPreview && (
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  <div className="mt-3 sm:mt-4 flex justify-center">
                    {!showAllBullets ? (
                      <button
                        onClick={() => setShowAllBullets(true)}
                        className="rounded-xl bg-gray-50 px-3 py-1.5 text-sm text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
                      >
                        Show all 10
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setShowAllBullets(false);
                          scrollToAbsoluteTop();
                        }}
                        className="rounded-xl bg-gray-50 px-3 py-1.5 text-sm text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
                      >
                        Show fewer
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* PART 2 — ARTICLES */}
      <section id="articles" className="mx-auto max-w-6xl px-3 sm:px-4 pb-14 sm:pb-16">
        <div className="mt-1 sm:mt-2 mb-3 sm:mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <h3 className="text-base sm:text-lg font-bold">Articles</h3>
            <span className="text-xs sm:text-sm text-gray-500">
              {loading && items.length === 0
                ? "Loading…"
                : err
                ? err
                : `${items.length} stor${items.length === 1 ? "y" : "ies"} in the last 7 days`}
            </span>
            <span className="hidden sm:inline text-xs text-gray-400">•</span>
            <span className="text-[11px] sm:text-xs text-gray-600 flex items-center gap-1">
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-700 ring-1 ring-emerald-200">
                UK
              </span>
              indicates UK-relevant
            </span>
          </div>

          <button onClick={scrollToAbsoluteTop} className="text-sm text-gray-700 hover:text-sky-700">
            Back to summary ↑
          </button>
        </div>
        <div className="h-px w-full bg-gradient-to-r from-transparent via-gray-200 to-transparent mb-5 sm:mb-6" />

        <div className={`transition-opacity duration-200 ${isSwitching ? "opacity-60" : "opacity-100"}`}>
          <ul className="grid gap-3 sm:gap-4 grid-cols-1 landscape:grid-cols-2 sm:grid-cols-2">
            {loading && items.length === 0 && (
              <>
                <li className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm animate-pulse">
                  <div className="h-3 w-40 rounded bg-gray-200" />
                  <div className="mt-2 h-5 w-3/4 rounded bg-gray-200" />
                  <div className="mt-3 h-16 w-full rounded bg-gray-200" />
                </li>
                <li className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm animate-pulse">
                  <div className="h-3 w-36 rounded bg-gray-200" />
                  <div className="mt-2 h-5 w-2/3 rounded bg-gray-200" />
                  <div className="mt-3 h-16 w-full rounded bg-gray-200" />
                </li>
              </>
            )}

            {(items.length > 0 || (loading && items.length > 0)) &&
              items.map((it, i) => {
                const key = `${it.url}-${i}`;
                const isOpen = !!expanded[key];
                const collapsedParas = getCollapsedParas(it);
                const expandedParas = getExpandedParas(it);
                const isUK = it.tags?.includes("uk");

                return (
                  <li
                    key={key}
                    className="group rounded-3xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] sm:text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700 ring-1 ring-sky-200">
                          {it.source}
                        </span>
                        <span className="mx-1">•</span>
                        {it.publishedAt
                          ? new Date(it.publishedAt).toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })
                          : "—"}
                      </div>

                      <div className="flex items-center gap-1.5 sm:gap-2">
                        {isUK && (
                          <span
                            title="Marked UK-relevant by the ranking engine"
                            className={`${pillBase} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200`}
                          >
                            UK
                          </span>
                        )}

                        {typeof it.score === "number" && (
                          <span
                            title={`Hotness: ${it.score?.toFixed?.(2) ?? it.score} (topic mentions: ${it.groupSize || 1})`}
                            className={`${pillBase} bg-orange-50 text-orange-700 ring-1 ring-orange-200`}
                          >
                            🔥 {Number.isFinite(it.score) ? it.score.toFixed(2) : it.score}
                          </span>
                        )}

                        {it.tags?.includes("top-take") && (
                          <span className={`${pillBase} bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200`}>
                            Top take
                          </span>
                        )}

                        <button
                          onClick={() => setExpanded((s) => ({ ...s, [key]: !s[key] }))}
                          className={`${pillBase} bg-gray-50 text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100`}
                          aria-expanded={isOpen}
                          aria-controls={`excerpt-${i}`}
                          title={isOpen ? "Collapse" : "Expand to ~30% of article"}
                        >
                          {isOpen ? "▲ Collapse" : "▼ Expand"}
                        </button>
                      </div>
                    </div>

                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="no-underline"
                      title="Open original in a new tab"
                    >
                      <h4 className="mt-2 line-clamp-3 text-[17px] sm:text-[18px] font-semibold tracking-tight text-gray-900 group-hover:text-sky-700">
                        {it.title}
                      </h4>
                    </a>

                    {!isOpen && collapsedParas.length > 0 && (
                      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-gray-700">
                        {collapsedParas.map((para, idx) => (
                          <p key={idx}>{para}</p>
                        ))}
                      </div>
                    )}

                    {isOpen && (
                      <div id={`excerpt-${i}`} className="mt-3 space-y-3 text-[15px] leading-relaxed">
                        {(expandedParas.length ? expandedParas : ["No preview available."]).map((para, idx) => (
                          <p key={idx} className="text-gray-800">
                            {para}
                          </p>
                        ))}
                        <div className="pt-1">
                          <a
                            href={`${it.url}${it.url.includes("?") ? "&" : "?"}utm_source=site&utm_medium=learn_more&utm_campaign=weekly`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sky-700 hover:underline"
                            aria-label={`Learn more at ${it.source}`}
                          >
                            Read the full article →
                          </a>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}

            {!loading && !err && !items.length && (
              <li className="rounded-3xl border border-gray-200 bg-white p-6 text-gray-500 shadow-sm">
                Loading articles from last week. Please follow the links in the summary for more detail
              </li>
            )}
          </ul>
        </div>
      </section>

      <button
        onClick={scrollToAbsoluteTop}
        className="fixed bottom-4 right-4 sm:bottom-5 sm:right-5 inline-flex h-9 w-9 sm:h-auto sm:w-auto items-center justify-center rounded-full bg-white/90 p-2.5 shadow-lg ring-1 ring-gray-200 hover:bg-white active:scale-[0.99]"
        title="Back to top"
        aria-label="Back to top"
      >
        ↑
      </button>

      <style jsx global>{`
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        @media (orientation: landscape) { .landscape\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      `}</style>
    </div>
  );
}
