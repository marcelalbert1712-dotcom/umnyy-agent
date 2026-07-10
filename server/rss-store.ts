import { promises as fs } from "node:fs";
import path from "node:path";

export type RSSFeed = {
  id: string;
  url: string;
  title: string;
  lastChecked: number;
  lastItemGuid: string | null;
  createdAt: number;
};

type RSSFile = { feeds: RSSFeed[] };

const DATA_DIR = path.join(process.cwd(), ".user-data");
const FILE = path.join(DATA_DIR, "rss-feeds.json");

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function read(): Promise<RSSFile> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return JSON.parse(raw) as RSSFile;
  } catch {
    return { feeds: [] };
  }
}

async function write(data: RSSFile): Promise<void> {
  await ensureDir();
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function listFeeds(): Promise<RSSFeed[]> {
  const f = await read();
  return f.feeds;
}

export async function addFeed(url: string, title?: string): Promise<RSSFeed> {
  const f = await read();
  if (f.feeds.some((x) => x.url === url)) {
    return f.feeds.find((x) => x.url === url)!;
  }
  const feed: RSSFeed = {
    id: `rss_${Date.now().toString(36)}`,
    url,
    title: title ?? url,
    lastChecked: 0,
    lastItemGuid: null,
    createdAt: Date.now(),
  };
  f.feeds.push(feed);
  await write(f);
  return feed;
}

export async function removeFeed(id: string): Promise<boolean> {
  const f = await read();
  const before = f.feeds.length;
  f.feeds = f.feeds.filter((x) => x.id !== id);
  await write(f);
  return f.feeds.length < before;
}

export async function updateFeed(id: string, patch: Partial<RSSFeed>): Promise<void> {
  const f = await read();
  const idx = f.feeds.findIndex((x) => x.id === id);
  if (idx === -1) return;
  f.feeds[idx] = { ...f.feeds[idx], ...patch };
  await write(f);
}

export type RSSItem = {
  title: string;
  link: string;
  pubDate: string;
  guid: string;
};

export type RSSCheckResult = {
  feedId: string;
  feedTitle: string;
  url: string;
  newItems: RSSItem[];
  totalItems: number;
  checkedAt: number;
};

export async function checkFeed(feedId: string): Promise<RSSCheckResult | null> {
  const f = await read();
  const feed = f.feeds.find((x) => x.id === feedId);
  if (!feed) return null;

  const Parser = (await import("rss-parser")).default;
  const parser = new Parser({
    timeout: 10000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  try {
    const parsed = await parser.parseURL(feed.url);
    const items: RSSItem[] = (parsed.items ?? []).map((it: any) => ({
      title: it.title ?? "(без заголовка)",
      link: it.link ?? "",
      pubDate: it.isoDate ?? it.pubDate ?? "",
      guid: String(it.guid ?? it.link ?? it.title ?? ""),
    }));

    const lastGuid = feed.lastItemGuid;
    const newItems = lastGuid ? items.filter((it) => it.guid !== lastGuid) : items.slice(0, 5);

    await updateFeed(feed.id, {
      lastChecked: Date.now(),
      lastItemGuid: items.length > 0 ? items[0].guid : lastGuid,
    });

    return {
      feedId: feed.id,
      feedTitle: feed.title ?? parsed.title ?? feed.url,
      url: feed.url,
      newItems: newItems.slice(0, 10),
      totalItems: items.length,
      checkedAt: Date.now(),
    };
  } catch (err: any) {
    await updateFeed(feed.id, { lastChecked: Date.now() });
    return {
      feedId: feed.id,
      feedTitle: feed.title,
      url: feed.url,
      newItems: [],
      totalItems: 0,
      checkedAt: Date.now(),
    };
  }
}

export async function checkAllFeeds(): Promise<RSSCheckResult[]> {
  const feeds = await listFeeds();
  const results: RSSCheckResult[] = [];
  for (const feed of feeds) {
    const res = await checkFeed(feed.id);
    if (res) results.push(res);
  }
  return results;
}