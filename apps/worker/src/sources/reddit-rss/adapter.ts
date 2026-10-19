import {
  MAX_POST_BODY,
  MAX_POST_TITLE,
  jobPostSchema,
  type JobPost,
} from "@redlance/core";
import { convert } from "html-to-text";
import type { RawEntry } from "./parse";

// Reddit RSS entry → the common JobPost (rule 2). Text posts carry their markdown between
// <!-- SC_OFF --> and <!-- SC_ON -->; image, gallery and link posts have no text, only a
// thumbnail table. Both end with a "submitted by … [link] [comments]" footer we drop.

const SC = /<!--\s*SC_OFF\s*-->([\s\S]*?)<!--\s*SC_ON\s*-->/i;

/** NFKC, invisible/control characters out (newlines kept), tidy whitespace, capped. */
export function cleanPostText(raw: string, max: number): string {
  return raw
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/(?!\n)[\p{Cf}\p{Cc}]/gu, "")
    .replace(/[  ]{2,}/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

export function bodyText(contentHtml: string | null): string {
  const md = contentHtml ? SC.exec(contentHtml) : null;
  if (!md) return "";
  const text = convert(md[1]!, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
      { selector: "img", format: "skip" },
      { selector: "h1", options: { uppercase: false } },
      { selector: "h2", options: { uppercase: false } },
      { selector: "h3", options: { uppercase: false } },
      { selector: "table", format: "dataTable" },
    ],
  });
  return cleanPostText(text, MAX_POST_BODY);
}

function author(name: string | null): string | null {
  const n = name?.trim().replace(/^\/?u\//i, "");
  if (!n || n === "[deleted]" || !/^[A-Za-z0-9_-]{1,40}$/.test(n)) return null;
  return n;
}

function date(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Null when the entry is malformed (missing id, link or date); the poller counts those. */
export function entryToJobPost(entry: RawEntry): JobPost | null {
  const postedAt = date(entry.published);
  const updated = date(entry.updated);
  const candidate = {
    source: "reddit" as const,
    externalId: entry.id?.trim() ?? "",
    fetchedVia: "rss" as const,
    community: (entry.category ?? "").trim().toLowerCase(),
    url: entry.link?.trim() ?? "",
    title: cleanPostText(entry.title ?? "", MAX_POST_TITLE),
    body: bodyText(entry.contentHtml),
    author: author(entry.author),
    postedAt,
    sourceUpdatedAt:
      updated && postedAt && updated.getTime() !== postedAt.getTime()
        ? updated
        : null,
  };
  const parsed = jobPostSchema.safeParse(candidate);
  if (!parsed.success || !parsed.data.title) return null;
  // The link must point at a post in the same subreddit the entry says it's from.
  const path = new URL(parsed.data.url).pathname.toLowerCase();
  if (!path.startsWith(`/r/${parsed.data.community}/comments/`)) return null;
  return parsed.data;
}
