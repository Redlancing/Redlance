import type { FieldError } from "@redlance/core";

/**
 * The first error for a field, including errors inside it ("skills.3.id" shows on "skills"), so
 * an error about a list item never goes unseen.
 */
export function errorMessageFor(
  errors: readonly FieldError[],
  path: string,
): string | undefined {
  return errors.find((e) => e.path === path || e.path.startsWith(`${path}.`))
    ?.message;
}
