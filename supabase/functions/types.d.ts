declare module 'https://deno.land/std@0.224.0/http/server.ts' {
  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
    opts?: { port?: number },
  ): void;
}

declare module 'https://esm.sh/@supabase/supabase-js@2.45.4' {
  export * from '@supabase/supabase-js';
}
