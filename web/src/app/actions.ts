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
                get(name: string) {
                    return cookieStore.get(name)?.value;
                },
                set(name: string, value: string, options: CookieOptions) {
                    try {
                        cookieStore.set({ name, value, ...options });
                    } catch (error) {
                        console.error('[actions] Cookie set failed:', error);
                    }
                },
                remove(name: string, options: CookieOptions) {
                    try {
                        cookieStore.set({ name, value: '', ...options });
                    } catch (error) {
                        console.error('[actions] Cookie remove failed:', error);
                    }
                },
            },
        }
    );

    // Fetch Tokens
    const { data: tokens, error: tokensError } = await supabase
        .from('device_tokens')
        .select('expo_push_token')
        .eq('resident_id', userId);

    if (tokensError) {
        console.error('[actions] Error fetching device tokens:', tokensError);
        return { success: false, error: 'Failed to fetch device tokens' };
    }

    try {
        // Send Expo push notifications
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
                const errorText = await resp.text();
                console.error('[actions] Expo Push Failed:', errorText);
                return { success: false, error: `Expo push notification failed: ${errorText}` };
            }
        }

        // Send web push notifications
        const { data: subs, error: subsError } = await supabase
            .from('web_push_subscriptions')
            .select('endpoint,p256dh,auth')
            .eq('resident_id', userId);

        if (subsError) {
            console.error('[actions] Error fetching web push subscriptions:', subsError);
        } else if (subs && subs.length > 0) {
            const result = await sendWebPush(subs, { title, body, data });
            if (result.expired.length > 0) {
                const { error: deleteError } = await supabase
                    .from('web_push_subscriptions')
                    .delete()
                    .in('endpoint', result.expired);

                if (deleteError) {
                    console.error('[actions] Error deleting expired subscriptions:', deleteError);
                }
            }
        }

        return { success: true };
    } catch (err: unknown) {
        const error = err as Error;
        console.error('[actions] Push notification error:', error);
        return { success: false, error: error?.message ?? 'Push notification failed' };
    }
}
