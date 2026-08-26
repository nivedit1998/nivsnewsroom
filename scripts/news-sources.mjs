export const SUMMARY_LIMIT = 5;

const rss = (url, label, allowedHosts, fallback) => ({
  kind: "rss",
  url,
  label,
  allowedHosts,
  ...(fallback ? { fallback } : {}),
});

const sitemap = (url, label, allowedHosts, includePath, fallback) => ({
  kind: "sitemap",
  url,
  label,
  allowedHosts,
  includePath,
  ...(fallback ? { fallback } : {}),
});

export const FEED_SOURCES = {
  hightech: [
    rss("https://www.cnet.com/rss/news/", "CNET", ["cnet.com", "www.cnet.com"]),
    rss("https://techcrunch.com/feed/", "TechCrunch", ["techcrunch.com", "www.techcrunch.com"]),
    rss("https://www.theverge.com/rss/index.xml", "The Verge", ["theverge.com", "www.theverge.com"]),
    rss("https://9to5google.com/feed/", "9to5Google", ["9to5google.com", "www.9to5google.com"]),
    rss("https://9to5mac.com/feed/", "9to5Mac", ["9to5mac.com", "www.9to5mac.com"]),
  ],
  telecoms: [
    rss(
      "https://telecomstechnews.com/feed",
      "Telecoms Tech News",
      ["telecomstechnews.com", "www.telecomstechnews.com"],
      "https://news.google.com/rss/search?q=site%3Atelecomstechnews.com&hl=en-GB&gl=GB&ceid=GB%3Aen"
    ),
    rss(
      "https://www.totaltele.com/category/technology/feed/",
      "Total Telecom",
      ["totaltele.com", "www.totaltele.com"],
      "https://news.google.com/rss/search?q=site%3Atotaltele.com%20technology&hl=en-GB&gl=GB&ceid=GB%3Aen"
    ),
    rss(
      "https://www.rcrwireless.com/rss",
      "RCR Wireless",
      ["rcrwireless.com", "www.rcrwireless.com"],
      "https://news.google.com/rss/search?q=site%3Arcrwireless.com&hl=en-GB&gl=GB&ceid=GB%3Aen"
    ),
    rss("https://www.gsma.com/newsroom/feed/", "GSMA Newsroom", ["gsma.com", "www.gsma.com"]),
  ],
};

export const COMPANY_SOURCES = {
  accenture: [
    sitemap(
      "https://newsroom.accenture.com/sitemap.xml",
      "Accenture Newsroom",
      ["newsroom.accenture.com"],
      /^\/news\/\d{4}\//i,
      "https://news.google.com/rss/search?q=site%3Anewsroom.accenture.com%2Fnews&hl=en-GB&gl=GB&ceid=GB%3Aen"
    ),
    sitemap(
      "https://newsroom.accenture.co.uk/sitemap.xml",
      "Accenture UK Newsroom",
      ["newsroom.accenture.co.uk"],
      /^\/english-uk\/news\/\d{4}\//i
    ),
  ],
  capco: [
    sitemap(
      "https://www.capco.com/sitemap.xml",
      "Capco Newsroom and Intelligence",
      ["capco.com", "www.capco.com"],
      /^\/(?:about-us\/newsroom-and-media|intelligence\/capco-intelligence)(?:\/|$)/i,
      "https://news.google.com/rss/search?q=site%3Acapco.com%2Fabout-us%2Fnewsroom-and-media+OR+site%3Acapco.com%2Fintelligence&hl=en-GB&gl=GB&ceid=GB%3Aen"
    ),
  ],
  sage: [
    rss(
      "https://www.sage.com/en-gb/blog/feed/",
      "Sage UK Blog",
      ["sage.com", "www.sage.com"],
      "https://news.google.com/rss/search?q=site%3Asage.com%20blog&hl=en-GB&gl=GB&ceid=GB%3Aen"
    ),
  ],
};

export const COMPANY_KEYS = Object.freeze(Object.keys(COMPANY_SOURCES));

export const COMPANY_ALLOWED_HOSTS = {
  accenture: new Set([
    "newsroom.accenture.com",
    "newsroom.accenture.co.uk",
    "accenture.com",
    "www.accenture.com",
  ]),
  capco: new Set(["capco.com", "www.capco.com"]),
  sage: new Set(["sage.com", "www.sage.com"]),
};

export const SOURCE_AUTHORITY = {
  "theverge.com": 0.25,
  "techcrunch.com": 0.25,
  "cnet.com": 0.2,
  "rcrwireless.com": 0.25,
  "totaltele.com": 0.2,
  "telecomstechnews.com": 0.2,
  "9to5google.com": 0.15,
  "9to5mac.com": 0.15,
  "lightreading.com": 0.28,
  "gsma.com": 0.35,
  "newsroom.accenture.com": 0.35,
  "newsroom.accenture.co.uk": 0.4,
  "accenture.com": 0.3,
  "capco.com": 0.3,
  "sage.com": 0.25,
  "ofcom.org.uk": 0.35,
  "openreach.co.uk": 0.3,
  "bt.com": 0.3,
  "vodafone.co.uk": 0.3,
  "virginmediao2.co.uk": 0.3,
  "o2.co.uk": 0.25,
  "ee.co.uk": 0.25,
  "three.co.uk": 0.25,
  "sky.com": 0.2,
  "talktalk.co.uk": 0.2,
  "ispreview.co.uk": 0.25,
  "thinkbroadband.com": 0.25,
};

export const SOURCE_REGISTRY = [
  ...Object.entries(FEED_SOURCES).flatMap(([group, sources]) =>
    sources.map((source) => ({ ...source, group }))
  ),
  ...Object.entries(COMPANY_SOURCES).flatMap(([company, sources]) =>
    sources.map((source) => ({ ...source, company }))
  ),
];

export const SOURCE_FALLBACKS = Object.fromEntries(
  SOURCE_REGISTRY
    .filter((source) => source.fallback)
    .map((source) => [source.url, source.fallback])
);
