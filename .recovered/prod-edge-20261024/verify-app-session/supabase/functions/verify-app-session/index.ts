import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createWebAppSessionVerificationHandler } from '../_shared/web-app-session-verification.ts';

serve(createWebAppSessionVerificationHandler());
