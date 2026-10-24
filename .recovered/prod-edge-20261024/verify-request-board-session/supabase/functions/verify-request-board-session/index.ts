import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { getEnv } from '../_shared/request-board-auth.ts';
import { createRequestBoardSessionVerificationHandler } from '../_shared/request-board-session-verification.ts';

serve(createRequestBoardSessionVerificationHandler(undefined,
  (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
));
