'use server';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { sendWebPush } from '@/lib/web-push';

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

    try {
        if (tokens && tokens.length > 0) {
            const uniqueTokens = Array.from(new Set(tokens.map(t => t.expo_push_token)));

            // Construct Expo Messages
            const messages = uniqueTokens.map(token => ({
                to: token,
                title,
                body,
                data,
                sound: 'default',
                priority: 'high',
                channelId: 'alerts',
            }));

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
            }
        }

        const { data: subs } = await supabase
            .from('web_push_subscriptions')
            .select('endpoint,p256dh,auth')
            .eq('resident_id', userId);

        if (subs && subs.length > 0) {
            const result = await sendWebPush(subs, { title, body, data });
            if (result.expired.length > 0) {
                await supabase.from('web_push_subscriptions').delete().in('endpoint', result.expired);
            }
        }

        return { success: true };
    } catch (err: any) {
        console.error('Expo Push Network Error:', err);
        return { success: false, error: err.message };
    }
}
