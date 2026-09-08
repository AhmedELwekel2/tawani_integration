/**
 * Typings for Supabase Edge Functions (Deno) when the editor uses the Vite
 * TypeScript project (no Deno LSP). Runtime behavior is unchanged.
 */

declare namespace Deno {
  interface Conn {
    read(p: Uint8Array): Promise<number | null>;
    write(p: Uint8Array): Promise<number>;
    close(): void;
  }
}

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  connect(options: { hostname: string; port: number }): Promise<Deno.Conn>;
  connectTls(options: { hostname: string; port: number }): Promise<Deno.Conn>;
};

declare module 'https://deno.land/std@0.168.0/http/server.ts' {
  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
  ): void;
}

declare module 'https://esm.sh/@supabase/supabase-js@2' {
  export function createClient(...args: unknown[]): import('@supabase/supabase-js').SupabaseClient;
}
