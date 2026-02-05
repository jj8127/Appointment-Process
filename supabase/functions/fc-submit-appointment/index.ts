import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

type Payload = {
    phone: string;
    date_field: string;
    date_value: string;
    type: 'life' | 'nonlife';
};

function getEnv(name: string): string | undefined {
    const g: any = globalThis as any;
    if (g?.Deno?.env?.get) return g.Deno.env.get(name);
    if (g?.process?.env) return g.process.env[name];
    return undefined;
}

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigins.length > 0 ? allowedOrigins[0] : '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabaseUrl = getEnv('SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(supabaseUrl!, serviceKey!);

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const body = (await req.json()) as Payload;
        const { phone, date_field, date_value, type } = body;
        const cleanPhone = phone.replace(/[^0-9]/g, '');

        if (!cleanPhone || cleanPhone.length !== 11) {
            throw new Error('Invalid phone number');
        }

        const { data: profile, error: profileError } = await supabase
            .from('fc_profiles')
            .select('id')
            .eq('phone', cleanPhone)
            .maybeSingle();

        if (profileError || !profile) {
            throw new Error('Profile not found');
        }

        const updateData: any = {
            [date_field]: date_value,
        };

        // Clear reject reason
        if (type === 'life') {
            updateData.appointment_reject_reason_life = null;
        } else {
            updateData.appointment_reject_reason_nonlife = null;
        }

        const { data, error } = await supabase
            .from('fc_profiles')
            .update(updateData)
            .eq('id', profile.id)
            .select()
            .single();

        if (error) throw error;

        return new Response(JSON.stringify({ ok: true, data }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (err: any) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
