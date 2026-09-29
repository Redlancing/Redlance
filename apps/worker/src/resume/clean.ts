export const MAX_RESUME_CHARS = 30_000;
export const MIN_RESUME_CHARS = 200;

export function cleanResumeText(raw: string): string {
  const text = raw
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/(?!\n)[\p{Cf}\p{Cc}]/gu, "")
    .replace(/ {2,}/g, " ");
  return text
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, MAX_RESUME_CHARS);
}
