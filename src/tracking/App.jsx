import { useState } from 'react';
import { config } from '../shared/lib/config.js';
import { lookupOrder } from '../shared/lib/orders.js';
import { useToast } from '../shared/components/Toast.jsx';
import FaviconSync from '../shared/components/FaviconSync.jsx';
import OrderStatusCard from './components/OrderStatusCard.jsx';

const params = new URLSearchParams(window.location.search);

export default function App() {
  const showToast = useToast();
  const [orderNumber, setOrderNumber] = useState(params.get('order') || '');
  const [wa, setWa] = useState('');
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState(null);
  const [searched, setSearched] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const code = orderNumber.trim().toUpperCase();
    const waTrimmed = wa.trim();
    if (!code || !waTrimmed) {
      showToast('Isi kode pesanan dan nomor WhatsApp dulu ya!', 'error');
      return;
    }

    setLoading(true);
    setSearched(false);
    try {
      const found = await lookupOrder(code, waTrimmed);
      setOrder(found);
      setSearched(true);
    } catch (err) {
      console.error('Lookup order error:', err);
      showToast('Gagal cek pesanan. Coba lagi ya!', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="trk-page">
      <FaviconSync />
      <header className="catalog-topbar">
        <a className="topbar-back" href="/" aria-label="Kembali ke katalog" style={{ textDecoration: 'none' }}>←</a>
        <div className="topbar-center">
          <span className="topbar-brand-name">Lacak Pesanan</span>
        </div>
        <div style={{ width: 36 }}></div>
      </header>

      <div className="trk-body">
        <form className="trk-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="trkOrderNumber">Kode Pesanan</label>
            <input
              type="text" id="trkOrderNumber" placeholder={`Contoh: ${config.orderPrefix}-9CMVY`}
              value={orderNumber} onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
              autoCapitalize="characters"
            />
          </div>
          <div className="form-group">
            <label htmlFor="trkWa">Nomor WhatsApp Pemesan</label>
            <input
              type="tel" id="trkWa" placeholder="08xxxxxxxxxx"
              value={wa} onChange={(e) => setWa(e.target.value)}
            />
            <p className="form-hint">Nomor yang sama waktu isi detail pemesan.</p>
          </div>
          <button type="submit" className="btn btn-primary trk-submit" disabled={loading}>
            {loading ? 'Mencari...' : 'Cek Status'}
          </button>
        </form>

        {searched && !order && (
          <div className="trk-notfound">
            <span>😕</span>
            <div>
              <strong>Pesanan tidak ditemukan</strong>
              <p>Cek lagi kode pesanan &amp; nomor WhatsApp-nya ya.</p>
            </div>
          </div>
        )}

        {order && <OrderStatusCard order={order} />}
      </div>
    </div>
  );
}
