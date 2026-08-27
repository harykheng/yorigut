import { useCallback } from 'react';
import { useCart } from '../CartContext.jsx';
import { supabase } from '../../shared/lib/supabaseClient.js';
import { config } from '../../shared/lib/config.js';
import { haversineDistance, calcShippingRate } from '../../shared/lib/shipping.js';

// Production path only — calls the Supabase Edge Function, which keeps the real
// BITESHIP_API_KEY server-side. No direct-call test-key path (see CLAUDE.md).
async function checkBiteshipRatesViaEdgeFunction(destLat, destLng, weightGrams, orderValue) {
  const { data, error } = await supabase.functions.invoke('check-shipping', {
    body: {
      originLat: config.storeLat, originLng: config.storeLng,
      destLat, destLng,
      weightGrams, orderValue,
    },
  });
  if (error || !data?.options?.length) throw new Error('no rates');
  return data.options;
}

export function useShipping() {
  const { dispatch } = useCart();

  // Fires exactly once per call — callers (ProfileModal's save handler, and
  // CheckoutStep's mount effect for returning customers) are responsible for
  // only calling this once per address, not on every address keystroke.
  const calculate = useCallback(async (destLat, destLng, weightGrams, orderValue) => {
    dispatch({ type: 'SET_SHIPPING_LOADING' });

    try {
      const options = await checkBiteshipRatesViaEdgeFunction(destLat, destLng, weightGrams, orderValue);
      dispatch({ type: 'SET_SHIPPING_OPTIONS', options });
      return;
    } catch {
      // Biteship unavailable / Edge Function not deployed yet / no courier for this
      // location — fall back to the static distance-based tiers.
    }

    const km = haversineDistance(config.storeLat, config.storeLng, destLat, destLng);
    const price = calcShippingRate(km);
    if (price === null) {
      dispatch({ type: 'SET_SHIPPING_UNAVAILABLE', km });
    } else {
      dispatch({ type: 'SET_SHIPPING_STATIC', price, label: `Flat Rate (${km.toFixed(1)} km)`, km });
    }
  }, [dispatch]);

  return { calculate };
}
