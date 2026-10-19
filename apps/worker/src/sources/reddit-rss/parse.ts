import { XMLParser } from "fast-xml-parser";

// Reddit's Atom feed → raw entries. Reddit never sends a DOCTYPE, so one is refused outright
// (no entity-expansion tricks); the parser only decodes the five XML entities.

export type RawEntry = {
  id: string | null;
  title: string | null;
  contentHtml: string | null;
  link: string | null;
  published: string | null;
  updated: string | null;
  /** "/u/name" as Reddit writes it, or null when there's no author element. */
  author: string | null;
  /** Subreddit as Reddit writes it (any casing). */
  category: string | null;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => name === "entry",
});

const text = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v) {
    const t = (v as { "#text": unknown })["#text"];
    return typeof t === "string" ? t : null;
  }
  return null;
};

const attr = (v: unknown, name: string): string | null => {
  const node = Array.isArray(v) ? v[0] : v;
  if (node && typeof node === "object") {
    const a = (node as Record<string, unknown>)[`@_${name}`];
    return typeof a === "string" ? a : null;
  }
  return null;
};

export class FeedParseError extends Error {}

export function parseAtomFeed(xml: string): RawEntry[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new FeedParseError("feed has a DOCTYPE");
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new FeedParseError((err as Error).message);
  }
  const feed = (doc as { feed?: { entry?: unknown[] } })?.feed;
  if (!feed) throw new FeedParseError("no <feed> element");
  return (feed.entry ?? []).map((raw) => {
    const e = (raw ?? {}) as Record<string, unknown>;
    const author = e.author as Record<string, unknown> | undefined;
    return {
      id: text(e.id),
      title: text(e.title),
      contentHtml: text(e.content),
      link: attr(e.link, "href"),
      published: text(e.published),
      updated: text(e.updated),
      author: author ? text(author.name) : null,
      category: attr(e.category, "term"),
    };
  });
}
