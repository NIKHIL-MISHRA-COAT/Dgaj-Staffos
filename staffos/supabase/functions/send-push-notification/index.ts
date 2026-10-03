import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// VAPID key utilities using Web Crypto API (available in Deno)
async function generateVAPIDAuthHeader(
  endpoint: string,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  subject: string
): Promise<string> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 3600;

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp: expiration, sub: subject };

  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Import private key
  const privateKeyBytes = base64UrlDecode(vapidPrivateKey);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    privateKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${encodedSignature}`;
  return `vapid t=${jwt},k=${vapidPublicKey}`;
}

function base64UrlDecode(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  const binary = atob(padded);
  return new Uint8Array(binary.split('').map(c => c.charCodeAt(0)));
}

async function encryptPayload(
  payload: string,
  p256dh: string,
  auth: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  // Generate server ECDH key pair
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  // Import client public key
  const clientPublicKeyBytes = base64UrlDecode(p256dh);
  const clientPublicKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey },
    serverKeyPair.privateKey,
    256
  );

  // Auth secret
  const authBytes = base64UrlDecode(auth);

  // Salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Export server public key
  const serverPublicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', serverKeyPair.publicKey)
  );

  // HKDF for content encryption key and nonce
  const prk = await hkdf(
    new Uint8Array(sharedSecret),
    authBytes,
    concat(new TextEncoder().encode('Content-Encoding: auth\0'), new Uint8Array(1)),
    32
  );

  const context = concat(
    new TextEncoder().encode('P-256\0'),
    new Uint8Array([(clientPublicKeyBytes.length >> 8) & 0xff, clientPublicKeyBytes.length & 0xff]),
    clientPublicKeyBytes,
    new Uint8Array([(serverPublicKeyBytes.length >> 8) & 0xff, serverPublicKeyBytes.length & 0xff]),
    serverPublicKeyBytes
  );

  const cek = await hkdf(prk, salt, concat(new TextEncoder().encode('Content-Encoding: aesgcm\0'), context), 16);
  const nonce = await hkdf(prk, salt, concat(new TextEncoder().encode('Content-Encoding: nonce\0'), context), 12);

  // Encrypt
  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const payloadBytes = new TextEncoder().encode(payload);
  const paddedPayload = new Uint8Array(payloadBytes.length + 2);
  paddedPayload.set(payloadBytes, 2);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, paddedPayload)
  );

  return { ciphertext, salt, serverPublicKey: serverPublicKeyBytes };
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    keyMaterial,
    length * 8
  );
  return new Uint8Array(bits);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) { result.set(arr, offset); offset += arr.length; }
  return result;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const body = await req.json();

    // Accepts two shapes:
    //  1. Direct call:            { user_id, title, message, url, type }
    //  2. Database Webhook on the notifications table (INSERT):
    //     { type: 'INSERT', table: 'notifications', record: { user_id, title, message, type, related_type, ... } }
    // Note: in a webhook body, `body.type` is the DB operation ('INSERT'),
    // so the notification's own type must come from `record.type`.
    const isWebhook = !!body?.record;
    const rec = isWebhook ? body.record : body;
    const { user_id, title, message, type } = rec;

    const routeByRelatedType: Record<string, string> = {
      leave_request: '/leave-management',
      task: '/my-tasks',
      recurring_task: '/recurring-tasks',
      payroll: '/payroll',
      holiday: '/holiday-management',
      ticket: '/ticket-centre',
      expense: '/expense-centre',
      document: '/documents',
      discrepancy: '/client-discrepancy-reports',
      calendar_event: '/calendar',
    };
    const url: string = rec.url ?? routeByRelatedType[rec.related_type ?? ''] ?? '/notifications';

    // Safety: a webhook row with no recipient must never fall through to the
    // "no user_id = send to everyone" behaviour below.
    if (isWebhook && !user_id) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: 'Webhook record has no user_id' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
    const vapidSubject = `mailto:admin@${new URL(Deno.env.get('SITE_URL') ?? 'https://staffos8924.builtwithrocket.new').hostname}`;

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get subscriptions for the user (or all users if no user_id)
    let query = supabaseAdmin.from('push_subscriptions').select('*');
    if (user_id) query = query.eq('user_id', user_id);

    const { data: subscriptions, error: subError } = await query;
    if (subError) throw subError;

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: 'No subscriptions found' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = JSON.stringify({
      title: title || 'DGaj Connect',
      body: message || 'You have a new notification',
      url: url || '/notifications',
      type: type || 'general',
      timestamp: Date.now(),
    });

    let sent = 0;
    const failed: string[] = [];

    for (const sub of subscriptions) {
      try {
        const { ciphertext, salt, serverPublicKey } = await encryptPayload(payload, sub.p256dh, sub.auth);
        const authHeader = await generateVAPIDAuthHeader(sub.endpoint, vapidPublicKey, vapidPrivateKey, vapidSubject);

        const saltB64 = btoa(String.fromCharCode(...salt)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const serverKeyB64 = btoa(String.fromCharCode(...serverPublicKey)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

        const response = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'aesgcm',
            'Encryption': `salt=${saltB64}`,
            'Crypto-Key': `dh=${serverKeyB64}`,
            'TTL': '86400',
          },
          body: ciphertext,
        });

        if (response.status === 201 || response.status === 200) {
          sent++;
        } else if (response.status === 410 || response.status === 404) {
          // Subscription expired — remove it
          await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          failed.push(sub.endpoint);
        } else {
          failed.push(sub.endpoint);
        }
      } catch (e) {
        failed.push(sub.endpoint);
      }
    }

    return new Response(JSON.stringify({ success: true, sent, failed: failed.length }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});