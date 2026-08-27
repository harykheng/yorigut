// Supabase Edge Function — proxy ke Biteship Rates API.
//
// Kenapa perlu proxy: Biteship API key itu secret dan TIDAK bisa dibatasi
// per-domain kayak AWS Places key. Kalau ditaruh langsung di js/config.js,
// siapapun yang buka DevTools bisa mengambil & memakai key ini. Browser
// cuma kirim koordinat tujuan ke sini, key aslinya cuma pernah ada di
// environment server (Supabase secrets), tidak pernah dikirim ke browser.
//
// Deploy: supabase functions deploy check-shipping
// Set secret: supabase secrets set BITESHIP_API_KEY=biteship_xxx...

const BITESHIP_API_KEY = Deno.env.get('BITESHIP_API_KEY');
const STORE_NAME = Deno.env.get('STORE_NAME') || 'Toko';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!BITESHIP_API_KEY) return json({ error: 'BITESHIP_API_KEY belum di-set di Supabase secrets' }, 500);

  try {
    const { originLat, originLng, destLat, destLng, weightGrams, orderValue } = await req.json();

    if (!originLat || !originLng || !destLat || !destLng) {
      return json({ error: 'Koordinat asal/tujuan wajib diisi' }, 400);
    }

    const biteshipRes = await fetch('https://api.biteship.com/v1/rates/couriers', {
      method: 'POST',
      headers: {
        authorization: BITESHIP_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        origin_latitude: originLat,
        origin_longitude: originLng,
        destination_latitude: destLat,
        destination_longitude: destLng,
        couriers: 'gosend,grab,paxel',
        items: [{
          name: `Pesanan ${STORE_NAME}`,
          description: 'Minuman & makanan',
          value: orderValue || 10000,
          weight: weightGrams || 300,
          quantity: 1,
        }],
      }),
    });

    const data = await biteshipRes.json();

    // Debug aid: we ask Biteship for gosend,grab,paxel but Biteship silently
    // drops any courier that isn't active/verified on the account or doesn't
    // cover this origin/destination — it's not something this function
    // filters. Check this log (Supabase Dashboard → Edge Functions →
    // check-shipping → Logs) to see exactly which couriers Biteship
    // actually returned pricing for on a given request.
    console.log('Biteship pricing response:', JSON.stringify(data.pricing));

    if (!biteshipRes.ok || !Array.isArray(data.pricing)) {
      return json({ error: data?.error || 'Biteship tidak mengembalikan tarif untuk lokasi ini' }, 502);
    }

    const options = data.pricing.map((p: Record<string, unknown>) => ({
      courierCode: p.courier_code,
      courierName: p.courier_name,
      serviceName: p.courier_service_name,
      price: p.price,
      duration: p.duration,
    }));

    return json({ options });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
