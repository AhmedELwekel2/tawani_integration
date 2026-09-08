/**
 * Escaping for values interpolated into PostgREST filter strings.
 *
 * `.or('a.ilike.%x%,b.ilike.%x%')` takes a raw filter *expression*, not bound
 * parameters. Dropping user input straight into it means a search containing a
 * comma, parenthesis or dot restructures the expression: searching for
 * `x,email.ilike.%` appends a whole extra predicate. That cannot bypass RLS, but
 * it silently widens results and 400s on ordinary input like "Smith, John".
 *
 * PostgREST's own rule: wrap the value in double quotes and backslash-escape any
 * embedded double quote or backslash. Quoted values may then contain commas,
 * dots and parentheses safely.
 *
 * LIKE wildcards are handled separately -- see `escapeLikePattern`.
 */

/**
 * Quote a value for use inside a PostgREST filter expression.
 *
 * @example
 *   `name.ilike.${quotePostgrestValue('%' + escapeLikePattern(q) + '%')}`
 */
export const quotePostgrestValue = (value: string): string =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Neutralise LIKE/ILIKE metacharacters in user input so a search for "50%" or
 * "a_b" matches literally instead of acting as a wildcard.
 *
 * Note this escapes with a backslash, which is PostgreSQL's default LIKE escape
 * character. Apply BEFORE adding your own surrounding wildcards.
 */
export const escapeLikePattern = (value: string): string =>
  value.replace(/([\\%_])/g, '\\$1');

/**
 * Build one `column.ilike.<value>` term with the search text safely contained.
 * Wildcards surround the whole (escaped) term, giving "contains" semantics.
 */
export const ilikeContains = (column: string, search: string): string =>
  `${column}.ilike.${quotePostgrestValue(`%${escapeLikePattern(search)}%`)}`;

/**
 * Build an `.or(...)` argument matching `search` against any of `columns`.
 * Returns null for blank input so callers can skip the filter entirely.
 */
export const buildOrContains = (columns: readonly string[], search: string): string | null => {
  const trimmed = search.trim();
  if (!trimmed) return null;
  return columns.map((column) => ilikeContains(column, trimmed)).join(',');
};
