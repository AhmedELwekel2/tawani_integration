import { describe, expect, it } from 'vitest';
import {
  buildOrContains,
  escapeLikePattern,
  ilikeContains,
  quotePostgrestValue,
} from './postgrestFilters';

describe('quotePostgrestValue', () => {
  it('wraps the value in double quotes so commas cannot split the filter', () => {
    expect(quotePostgrestValue('Smith, John')).toBe('"Smith, John"');
  });

  it('escapes embedded double quotes', () => {
    expect(quotePostgrestValue('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('escapes backslashes before quotes, so the two do not interact', () => {
    expect(quotePostgrestValue('a\\b')).toBe('"a\\\\b"');
    // A trailing backslash must not escape the closing quote.
    expect(quotePostgrestValue('a\\')).toBe('"a\\\\"');
  });
});

describe('escapeLikePattern', () => {
  it('neutralises LIKE wildcards so they match literally', () => {
    expect(escapeLikePattern('50%')).toBe('50\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
  });

  it('escapes backslashes too', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });
});

describe('ilikeContains', () => {
  it('produces a quoted contains-term for ordinary input', () => {
    expect(ilikeContains('email', 'ali')).toBe('email.ilike."%ali%"');
  });

  it('contains a comma inside the quotes rather than starting a new predicate', () => {
    const term = ilikeContains('full_name_en', 'Smith, John');
    expect(term).toBe('full_name_en.ilike."%Smith, John%"');
    // The comma must sit inside the quoted region.
    const firstQuote = term.indexOf('"');
    const lastQuote = term.lastIndexOf('"');
    expect(term.indexOf(',')).toBeGreaterThan(firstQuote);
    expect(term.indexOf(',')).toBeLessThan(lastQuote);
  });

  it('double-escapes a literal % so PostgREST unquoting leaves a LIKE escape', () => {
    // escapeLikePattern -> 50\%   then quoting doubles the backslash -> 50\\%
    // PostgREST unquotes \\ to \, so Postgres receives 50\% = a literal percent.
    expect(ilikeContains('notes', '50%')).toBe('notes.ilike."%50\\\\%%"');
  });

  it('defuses the injection shape from the audit: a value that opened a new predicate', () => {
    const term = ilikeContains('action', 'x%,actor_email.ilike.%');
    // Everything the user typed stays inside one quoted value.
    expect(term.startsWith('action.ilike."%')).toBe(true);
    expect(term.endsWith('%"')).toBe(true);
    // No bare comma outside the quotes.
    expect(term.slice(0, term.indexOf('"'))).not.toContain(',');
  });
});

describe('buildOrContains', () => {
  it('joins one term per column', () => {
    expect(buildOrContains(['a', 'b'], 'x')).toBe('a.ilike."%x%",b.ilike."%x%"');
  });

  it('returns null for blank input so the caller can skip the filter', () => {
    expect(buildOrContains(['a'], '')).toBeNull();
    expect(buildOrContains(['a'], '   ')).toBeNull();
  });

  it('trims the search term', () => {
    expect(buildOrContains(['a'], '  x  ')).toBe('a.ilike."%x%"');
  });
});
