import { Expo } from 'expo-server-sdk';

const expo = new Expo();

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { to, title, body: messageBody, data } = body;

        if (!Expo.isExpoPushToken(to)) {
            console.error(`Push token ${to} is not a valid Expo push token`);
            // Return success to avoid blocking the client, but log error
            return Response.json({ status: 'ignored' });
        }

        const messages = [
            {
                to,
                sound: 'default',
                title,
                body: messageBody,
                data,
                channelId: 'alerts',
                priority: 'high',
            },
        ];

        const chunks = expo.chunkPushNotifications(messages as any);
        const tickets = [];

        for (const chunk of chunks) {
            try {
                const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
                tickets.push(...ticketChunk);
            } catch (error) {
                console.error(error);
            }
        }

        return Response.json({ status: 'ok', tickets });
    } catch (error: any) {
        console.error('Push API Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
}
