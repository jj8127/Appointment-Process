import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase 환경변수가 설정되지 않았습니다. .env에 EXPO_PUBLIC_SUPABASE_URL/ANON_KEY를 추가하세요.');
} else {
  const maskedKey = `${supabaseAnonKey.slice(0, 6)}...${supabaseAnonKey.slice(-6)}`;
  console.log('[supabase env]', { url: supabaseUrl, anonKey: maskedKey });
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
