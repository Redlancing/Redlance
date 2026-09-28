/** Result of trying to add a typed word to a tag list. `values` is unchanged when nothing was added. */
export function addTag(
  values: readonly string[],
  raw: string,
  limits: { max: number; maxLength: number },
): { values: string[]; added: boolean } {
  const word = raw.trim();
  const dup = values.some((v) => v.toLowerCase() === word.toLowerCase());
  if (!word || word.length > limits.maxLength || dup || values.length >= limits.max)
    return { values: [...values], added: false };
  return { values: [...values, word], added: true };
}
