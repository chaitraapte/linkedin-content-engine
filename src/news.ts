import { config } from "./config.ts";

export interface Headline {
  title: string;
  source: string;
  date: string;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

const tag = (xml: string, name: string) => decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "");

/** Google News RSS search — free, no API key. */
export async function searchNews(query: string, limit = 5): Promise<Headline[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + " when:30d")}&${config.newsLocale}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map(([, item]) => ({
    title: tag(item, "title"),
    source: tag(item, "source"),
    date: new Date(tag(item, "pubDate")).toDateString(),
  }));
}

export async function headlinesFor(queries: string[]): Promise<string> {
  const results = await Promise.allSettled(queries.slice(0, 3).map((q) => searchNews(q)));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const h of r.value) {
      if (seen.has(h.title)) continue;
      seen.add(h.title);
      lines.push(`- ${h.title} (${h.date})`);
    }
  }
  return lines.slice(0, 12).join("\n");
}
