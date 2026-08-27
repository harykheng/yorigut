import { useEffect, useState } from 'react';
import { useCart } from '../CartContext.jsx';
import { useProducts } from '../../shared/hooks/useProducts.js';
import { config } from '../../shared/lib/config.js';
import { formatPrice } from '../../shared/lib/format.js';
import { cartCount, cartTotal } from '../../shared/lib/cart.js';
import { waLink } from '../../shared/lib/whatsapp.js';
import ProductCard from './ProductCard.jsx';

export default function CatalogStep({ settings, onPickVariant }) {
  const { state, dispatch } = useCart();
  const { products, loading, error } = useProducts({ onlyVisible: true });
  const [cartExpanded, setCartExpanded] = useState(false);

  const brandName = settings?.brand_name || config.storeName;
  const logoUrl = settings?.logo_url;
  const logoTextUrl = settings?.logo_text_url;
  const brandIcon = settings?.brand_icon || '☕';
  const bannerTitle = settings?.banner_title || config.bannerTitle;
  const bannerSub = settings?.banner_subtitle || config.bannerSubtitle;
  const bannerImg = settings?.banner_image_url;
  const waHelpUrl = waLink(config.adminWhatsapp, `Halo ${brandName}, saya butuh bantuan untuk pemesanan!`);

  const count = cartCount(state.cart);
  const total = cartTotal(state.cart);

  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => { if (count === 0) setCartExpanded(false); }, [count]);

  function goBack() {
    dispatch({ type: 'SET_STEP', step: 1 });
    window.scrollTo(0, 0);
  }

  function goToStep3() {
    if (!count) return;
    dispatch({ type: 'SET_STEP', step: 3 });
    window.scrollTo(0, 0);
  }

  return (
    <div className="step active">
      <header className="catalog-topbar">
        <button className="topbar-back" onClick={goBack} aria-label="Kembali">←</button>
        <div className="topbar-center">
          {logoUrl ? (
            <img className="topbar-icon brand-icon-logo" src={logoUrl} alt={brandName} />
          ) : (
            <span className="topbar-icon">{brandIcon}</span>
          )}
          {logoTextUrl ? (
            <img className="topbar-brand-name-logo" src={logoTextUrl} alt={brandName} />
          ) : (
            <span className="topbar-brand-name">{brandName}</span>
          )}
        </div>
        <a className="btn-wa-icon" href={waHelpUrl} target="_blank" rel="noopener noreferrer" aria-label="Butuh bantuan?">
          💬
        </a>
      </header>

      <div className="order-info-strip">
        <div className="ois-left">
          <span className="ois-pill">{state.orderType === 'pickup' ? '🏠 Pickup' : '🛵 Delivery'}</span>
          <span className="ois-sep">·</span>
          <span className="ois-date">{state.selectedDateLabel}</span>
        </div>
        <button className="ois-change" onClick={goBack}>Ubah</button>
      </div>

      <div className={`catalog-banner${bannerImg ? ' has-image' : ''}`}>
        {bannerImg && <img className="banner-bg-img" src={bannerImg} alt="" aria-hidden="true" />}
        <div className="banner-inner">
          <div className="banner-texts">
            <div className="banner-title">{bannerTitle}</div>
            <div className="banner-sub">{bannerSub}</div>
          </div>
        </div>
      </div>

      <main className="products-section">
        <div className="section-label">Menu Kami</div>
        <div className="products-grid">
          {loading && (
            <div className="loading-state">
              <div className="spinner"></div>
              <span>Memuat menu...</span>
            </div>
          )}
          {!loading && error && (
            <div className="catalog-error">
              <span className="catalog-error-icon">😔</span>
              <h3>Gagal memuat menu</h3>
              <p>Coba refresh halaman ini ya!</p>
            </div>
          )}
          {!loading && !error && products.length === 0 && (
            <div className="catalog-empty">
              <span className="catalog-empty-icon">☕</span>
              <h3>Menu segera hadir!</h3>
              <p>Produk sedang kami siapkan.</p>
            </div>
          )}
          {!loading && !error && products.map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} onPickVariant={onPickVariant} />
          ))}
        </div>
      </main>

      <div className={`catalog-sticky-footer${count > 0 ? ' visible' : ''}${cartExpanded ? ' expanded' : ''}`}>
        <div className={`csf-list${cartExpanded ? ' open' : ''}`}>
          {Object.entries(state.cart).map(([key, { product, qty, variantLabels, extraPrice = 0 }]) => (
            <div className="csf-list-item" key={key}>
              <div className="csf-list-item-info">
                <div className="csf-list-item-name">{product.name}</div>
                {variantLabels?.length > 0 && (
                  <div className="csf-list-item-var">{variantLabels.join(' · ')}</div>
                )}
              </div>
              <div className="csf-list-item-qty">× {qty}</div>
              <div className="csf-list-item-price">{formatPrice((product.price + extraPrice) * qty)}</div>
            </div>
          ))}
        </div>

        <div className="csf-bar" onClick={() => setCartExpanded((v) => !v)} role="button" tabIndex={0} aria-expanded={cartExpanded}>
          <div className="csf-left">
            <div className="csf-icon">🛒</div>
            <div className="csf-info">
              <div className="csf-qty">{count} item</div>
              <div className="csf-total">{formatPrice(total)}</div>
            </div>
            <span className={`csf-chevron${cartExpanded ? ' open' : ''}`} aria-hidden="true">▲</span>
          </div>
          <button className="csf-cta" onClick={(e) => { e.stopPropagation(); goToStep3(); }}>Lanjutkan →</button>
        </div>
      </div>
    </div>
  );
}
