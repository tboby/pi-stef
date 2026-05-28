/**
 * Slug = YYYY-MM-DD-<kebab>. Used for plan-folder names so plans sort
 * chronologically when listed.
 */
export function slugify(title: string, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const kebab = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (kebab.length === 0) {
    throw new Error(`slugify: title "${title}" has no slug-able characters`);
  }
  return `${date}-${kebab}`;
}

/**
 * Slug for a followup tool run: `<date>-followup-<kebab(title)>`.
 *
 * The followup gets its own plan folder under
 * `ai_plan/<date>-followup-<kebab>/` (e.g. `2026-05-08-followup-better-anim`),
 * matching the existing chronological-sort convention. Implementation
 * defers to `slugify` so the date prefix and kebab rules are enforced in
 * exactly one place.
 */
export function followupSlug(title: string, now: Date = new Date()): string {
  return slugify(`followup ${title}`, now);
}
