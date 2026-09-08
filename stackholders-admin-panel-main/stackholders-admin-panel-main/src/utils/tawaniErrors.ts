/**
 * Map an error thrown by `tawaniClient` onto a translation key.
 *
 * The client throws sentinel messages for the three failures an operator can
 * actually act on -- service down, service too slow, URL not configured -- and
 * passes the agent's own Arabic `detail` through unchanged for everything else.
 * Callers use the raw message as the fallback so that detail is never lost.
 */
export const tawaniErrorKey = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  switch (message) {
    case 'TAWANI_UNREACHABLE':    return 'tawani.errors.unreachable';
    case 'TAWANI_TIMEOUT':        return 'tawani.errors.timeout';
    case 'TAWANI_NOT_CONFIGURED': return 'tawani.notConfigured';
    default:                      return 'tawani.errors.generic';
  }
};
