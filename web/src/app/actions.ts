'use server';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type PushDate = {
    title: string;
    body: string;
    data?: Record<string, any>;
};

export async function sendPushNotification(
    userId: string,
    { title, body, data }: PushDate
) {
    if (!userId) return { success: false, error: 'No user ID provided' };

    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) {
                    try { cookieStore.set({ name, value, ...options }); } catch (error) { }
                },
                remove(name: string, options: CookieOptions) {
                    try { cookieStore.set({ name, value: '', ...options }); } catch (error) { }
                },
            },
        }
    );

    // Fetch Tokens
    const { data: tokens, error } = await supabase
        .from('device_tokens')
        .select('expo_push_token')
        .eq('resident_id', userId);

    if (error || !tokens || tokens.length === 0) {
        // No tokens usually means user hasn't logged in app yet.
        return { success: false, error: 'No device tokens found' };
    }

    const uniqueTokens = Array.from(new Set(tokens.map(t => t.expo_push_token)));

    // Construct Expo Messages
    const messages = uniqueTokens.map(token => ({
        to: token,
        title,
        body,
        data,
    }));

    try {
        const resp = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(messages),
        });

        if (!resp.ok) {
            console.error('Expo Push Failed:', await resp.text());
            return { success: false, error: 'Expo API Error' };
        }

        return { success: true };
    } catch (err: any) {
        console.error('Expo Push Network Error:', err);
        return { success: false, error: err.message };
    }
}
