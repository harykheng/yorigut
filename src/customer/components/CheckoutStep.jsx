import { useEffect, useState } from 'react';
import { useCart } from '../CartContext.jsx';
import { useShipping } from '../hooks/useShipping.js';
import { config } from '../../shared/lib/config.js';
import { formatPrice } from '../../shared/lib/format.js';
import { cartCount, cartTotal, getDiscountAmount, cartFinalTotal } from '../../shared/lib/cart.js';
import { fetchActivePromoByCode } from '../../shared/lib/promos.js';
import OngkirOptions from './OngkirOptions.jsx';

export default function CheckoutStep({ settings, onOpenProfile, onSubmitQris }) {
  const { state, dispatch } = useCart();
  const { calculate } = useShipping();
  const [promoInput, setPromoInput] = useState('');
  const [promoResult, setPromoResult] = useState(null); // { type: 'success'|'error', msg }
  const [promoChecking, setPromoChecking] = useState(false);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  // Auto-check ongkir on entering checkout — only when the profile already
  // has a saved address (returning customer, lat/lng from localStorage) and
  // shipping hasn't been calculated yet this session. Fires once per mount
  // (empty deps, CheckoutStep unmounts/remounts on step change), not on
  // every address change — see the single-check-on-save note in useShipping.js.
  useEffect(() => {
    if (
      state.orderType === 'delivery' &&
      state.profile.lat && state.profile.lng &&
      state.shippingStatus === 'idle'
    ) {
      const weightGrams = cartCount(state.cart) * config.defaultItemWeightG;
      calculate(state.profile.lat, state.profile.lng, weightGrams, cartTotal(state.cart));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const storeName = settings?.brand_name || config.storeName;
  const storeAddress = settings?.store_address || config.storeAddress;
  const storeMapsUrl = settings?.store_maps_url || config.storeMapsUrl;

  const discount = getDiscountAmount(state.cart, state.activePromo);
  const finalTotal = cartFinalTotal(state.cart, state.activePromo, state.selectedShipping);

  function goBack() {
    dispatch({ type: 'SET_STEP', step: 2 });
    dispatch({ type: 'REMOVE_PROMO' });
    dispatch({ type: 'SET_SHIPPING', shipping: null });
    window.scrollTo(0, 0);
  }

  function removeCartItem(key) {
    dispatch({ type: 'REMOVE_CART_ITEM', key });
    if (Object.keys(state.cart).length <= 1) {
      goBack();
    }
  }

  async function applyPromo() {
    const code = promoInput.trim().toUpperCase();
    if (!code) { setPromoResult({ type: 'error', msg: 'Masukkan kode promo dulu ya!' }); return; }

    setPromoChecking(true);
    try {
      const promo = await fetchActivePromoByCode(code);
      const raw = cartTotal(state.cart);

      if (!promo) {
        setPromoResult({ type: 'error', msg: `Kode "${code}" tidak valid atau sudah tidak aktif.` });
        dispatch({ type: 'REMOVE_PROMO' });
      } else if (promo.min_order > 0 && raw < promo.min_order) {
        setPromoResult({ type: 'error', msg: `Min. order ${formatPrice(promo.min_order)} untuk pakai kode ini.` });
        dispatch({ type: 'REMOVE_PROMO' });
      } else {
        dispatch({ type: 'APPLY_PROMO', promo });
        const label = promo.discount_type === 'percent' ? `${promo.discount_value}%` : formatPrice(promo.discount_value);
        setPromoResult({ type: 'success', msg: `Yeay! Diskon ${label} berhasil diterapkan 🎉` });
      }
    } catch {
      setPromoResult({ type: 'error', msg: 'Gagal cek kode. Coba lagi ya!' });
      dispatch({ type: 'REMOVE_PROMO' });
    } finally {
      setPromoChecking(false);
    }
  }

  function removePromo() {
    dispatch({ type: 'REMOVE_PROMO' });
    setPromoInput('');
    setPromoResult(null);
  }

  return (
    <div className="step active">
      <header className="catalog-topbar">
        <button className="topbar-back" onClick={goBack} aria-label="Kembali">←</button>
        <div className="topbar-center">
          <span className="topbar-brand-name" style={{ fontSize: 15 }}>Detail Pesanan</span>
        </div>
        <div style={{ width: 36 }}></div>
      </header>

      <div className="checkout-body">

        <div className="co-section">
          <div className="co-section-title">Detail Pengiriman</div>

          <div className="co-meta-card">
            <div className="co-meta-row">
              <span className="co-meta-icon">📅</span>
              <div>
                <div className="co-meta-label">Tanggal</div>
                <div className="co-meta-value">{state.selectedDateLabel || '-'}</div>
              </div>
            </div>
            <div className="co-meta-divider"></div>
            <div className="co-meta-row">
              <span className="co-meta-icon">{state.orderType === 'pickup' ? '🏠' : '🛵'}</span>
              <div>
                <div className="co-meta-label">Tipe Pesanan</div>
                <div className="co-meta-value">{state.orderType === 'pickup' ? 'Pickup' : 'Delivery'}</div>
              </div>
            </div>
          </div>

          {state.orderType === 'pickup' ? (
            <div className="co-pickup-card">
              <div className="co-meta-row">
                <span className="co-meta-icon">📍</span>
                <div>
                  <div className="co-meta-label">Lokasi Pickup</div>
                  <div className="co-meta-value">{storeName}</div>
                  <div className="co-pickup-addr">{storeAddress}</div>
                  <a className="pickup-maps-link" href={storeMapsUrl} target="_blank" rel="noopener" style={{ marginTop: 8, display: 'inline-flex' }}>
                    Buka di Google Maps →
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="co-pickup-card" style={{ marginTop: 12 }}>
                <div className="co-meta-row">
                  <span className="co-meta-icon">🏪</span>
                  <div>
                    <div className="co-meta-label">Dikirim dari</div>
                    <div className="co-meta-value">{storeName}</div>
                    <div className="co-pickup-addr">{storeAddress}</div>
                  </div>
                </div>
              </div>
              <OngkirOptions />
            </div>
          )}
        </div>

        <div className="co-section">
          <div className="co-section-title">Info Pemesan</div>
          <div className={`profile-card${state.isProfileFilled ? ' is-filled' : ''}`} onClick={onOpenProfile} role="button" tabIndex={0}>
            <div className="profile-card-avatar">👤</div>
            <div className="profile-card-info">
              <div className="profile-card-name">
                {state.isProfileFilled ? state.profile.name : 'Tambahkan detail pemesan'}
              </div>
              <div className="profile-card-sub">
                {state.isProfileFilled
                  ? state.profile.wa + (state.orderType === 'delivery' ? ' · ' + state.profile.address.split(',')[0] : '')
                  : 'Nama & Nomor WhatsApp'}
              </div>
            </div>
            <div className="profile-card-arrow">›</div>
          </div>
        </div>

        <div className="co-section">
          <div className="co-section-title">Pesananmu</div>
          <div>
            {Object.entries(state.cart).map(([key, { product, qty, variantLabels, extraPrice = 0 }]) => {
              const unitPrice = product.price + extraPrice;
              return (
                <div className="co-item" key={key}>
                  {product.image_url
                    ? <img className="co-item-img" src={product.image_url} alt={product.name} loading="lazy" />
                    : <div className="co-item-img co-item-img-ph">☕</div>}
                  <div className="co-item-info">
                    <div className="co-item-name">{product.name}</div>
                    {variantLabels?.length > 0 && (
                      <div className="co-item-variants">{variantLabels.join(' · ')}</div>
                    )}
                    <div className="co-item-qty">× {qty}</div>
                  </div>
                  <div className="co-item-price">{formatPrice(unitPrice * qty)}</div>
                  <button className="co-item-del" onClick={() => removeCartItem(key)} aria-label="Hapus">✕</button>
                </div>
              );
            })}
          </div>
          {discount > 0 && (
            <div className="co-discount-row">
              <span className="co-total-label">🎟 Diskon</span>
              <span className="co-discount-amount">−{formatPrice(discount)}</span>
            </div>
          )}
          {state.selectedShipping && state.orderType === 'delivery' && (
            <div className="co-shipping-row">
              <span className="co-total-label">🛵 Ongkir</span>
              <span className="co-shipping-amount">{formatPrice(state.selectedShipping.price)}</span>
            </div>
          )}
          <div className="co-total-row">
            <span className="co-total-label">Total</span>
            <span className="co-total-amount">{formatPrice(finalTotal)}</span>
          </div>
        </div>

        <div className="co-section">
          <div className="co-section-title">Kode Promo</div>
          <div className="promo-input-wrap">
            <input
              type="text"
              className="promo-input"
              placeholder="Punya kode promo?"
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value.toUpperCase().replace(/\s/g, ''))}
            />
            <button type="button" className="promo-apply-btn" onClick={applyPromo} disabled={promoChecking}>
              {promoChecking ? '...' : 'Pakai'}
            </button>
          </div>
          {promoResult && (
            <div className="promo-result" style={{ display: 'flex' }}>
              {promoResult.type === 'success' ? (
                <>
                  <span className="promo-ok">✅ {promoResult.msg}</span>
                  <button className="promo-remove-btn" onClick={removePromo}>Hapus</button>
                </>
              ) : (
                <span className="promo-err">❌ {promoResult.msg}</span>
              )}
            </div>
          )}
        </div>

        <div className="co-section">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="customerNote">Catatan (Opsional)</label>
            <textarea
              id="customerNote"
              placeholder="Ada permintaan khusus?"
              rows={2}
              value={state.note}
              onChange={(e) => dispatch({ type: 'SET_NOTE', note: e.target.value })}
            />
          </div>
        </div>

        <div className="co-submit">
          <button className="btn-wa-send" onClick={onSubmitQris}>
            Bayar via QRIS 💳
          </button>
        </div>

        <footer className="site-footer">
          <div className="footer-powered">Powered by <span className="footer-brand">Studio Harel</span></div>
        </footer>

      </div>
    </div>
  );
}
