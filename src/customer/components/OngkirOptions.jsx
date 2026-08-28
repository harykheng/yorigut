import { useCart } from '../CartContext.jsx';
import { formatPrice } from '../../shared/lib/format.js';

export default function OngkirOptions() {
  const { state, dispatch } = useCart();
  const { shippingStatus, shippingOptions, shippingStaticKm, selectedShipping } = state;

  if (shippingStatus === 'idle') return <div style={{ marginTop: 10 }}></div>;

  if (shippingStatus === 'loading') {
    return (
      <div style={{ marginTop: 10 }}>
        <div className="ongkir-loading"><span className="spinner-sm"></span> Mengecek ongkir…</div>
      </div>
    );
  }

  if (shippingStatus === 'unavailable') {
    return (
      <div style={{ marginTop: 10 }}>
        <div className="ongkir-unavailable">
          <span>😔</span>
          <div>
            <strong>Di luar jangkauan delivery</strong>
            <div>{shippingStaticKm?.toFixed(1)} km dari toko — maks. 10 km</div>
          </div>
        </div>
      </div>
    );
  }

  if (shippingStatus === 'static') {
    return (
      <div style={{ marginTop: 10 }}>
        <div className="ongkir-static-result">
          <div className="ongkir-left">
            <div className="ongkir-courier">Ongkos Kirim</div>
            <div className="ongkir-eta">{shippingStaticKm?.toFixed(1)} km dari toko</div>
          </div>
          <div className="ongkir-price">{formatPrice(selectedShipping?.price || 0)}</div>
        </div>
      </div>
    );
  }

  // shippingStatus === 'options' — group by courier (Gojek/Grab/Paxel/...) so a
  // route with several couriers × several service tiers each doesn't read as
  // one long undifferentiated list. Keeps the original flat index per item
  // (SELECT_SHIPPING_OPTION dispatches by index into the flat shippingOptions
  // array in CartContext) even though rendering is grouped.
  const groups = [];
  const groupIndexByCourier = new Map();
  shippingOptions.forEach((o, i) => {
    const key = o.courierCode || o.courierName;
    if (!groupIndexByCourier.has(key)) {
      groupIndexByCourier.set(key, groups.length);
      groups.push({ courierName: o.courierName, items: [] });
    }
    groups[groupIndexByCourier.get(key)].items.push({ ...o, index: i });
  });
  groups.forEach((g) => g.items.sort((a, b) => a.price - b.price));

  return (
    <div style={{ marginTop: 10 }}>
      <div className="ongkir-options-list">
        {groups.map((g) => (
          <div className="ongkir-courier-group" key={g.courierName}>
            <div className="ongkir-courier-group-label">{g.courierName}</div>
            {g.items.map((o) => {
              const isSelected = selectedShipping?.label === `${o.courierName} - ${o.serviceName}`;
              return (
                <div
                  key={`${o.courierCode}-${o.serviceName}`}
                  className={`ongkir-option-item${isSelected ? ' selected' : ''}`}
                  onClick={() => dispatch({ type: 'SELECT_SHIPPING_OPTION', index: o.index })}
                >
                  <div className="ongkir-left">
                    <div className="ongkir-courier">{o.serviceName}</div>
                    <div className="ongkir-eta">{o.duration || ''}</div>
                  </div>
                  <div className="ongkir-price">{formatPrice(o.price)}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
