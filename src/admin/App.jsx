import { useState } from 'react';
import { config } from '../shared/lib/config.js';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { useSettings } from '../shared/hooks/useSettings.js';
import { ConfirmDialogProvider } from '../shared/components/ConfirmDialog.jsx';
import FaviconSync from '../shared/components/FaviconSync.jsx';
import { useNewOrderAlerts } from './hooks/useNewOrderAlerts.js';
import LoginScreen from './components/LoginScreen.jsx';
import DashboardTab from './components/DashboardTab.jsx';
import ProductsTab from './components/ProductsTab.jsx';
import PromoTab from './components/PromoTab.jsx';
import OrdersTab from './components/OrdersTab.jsx';
import SettingsTab from './components/SettingsTab.jsx';

const TABS = [
  { key: 'dashboard', label: '📊 Dashboard' },
  { key: 'products', label: '🛍 Produk' },
  { key: 'promo', label: '🎟 Promo' },
  { key: 'orders', label: '📦 Pesanan' },
  { key: 'settings', label: '⚙️ Pengaturan' },
];

function Dashboard() {
  const { session, logout } = useAuth();
  const { settings } = useSettings();
  const logoUrl = settings?.logo_url;
  const [activeTab, setActiveTab] = useState('dashboard');
  const newOrders = useNewOrderAlerts();

  function selectTab(key) {
    setActiveTab(key);
    if (key === 'orders') newOrders.clear();
  }

  return (
    <div className="admin-layout active">
      <header className="admin-header">
        <div className="logo">
          {logoUrl && <img className="logo-icon-img" src={logoUrl} alt={config.storeName} />}
          <div className="logo-text">{config.storeName} Admin</div>
        </div>
        <div className="admin-header-right">
          <span className="admin-user-email">{session.user.email}</span>
          <button className="btn-logout" onClick={logout}>Keluar</button>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`admin-tab${activeTab === t.key ? ' active' : ''}`}
              onClick={() => selectTab(t.key)}
            >
              {t.label}
              {t.key === 'orders' && newOrders.count > 0 && (
                <span className="admin-tab-badge">{newOrders.count > 9 ? '9+' : newOrders.count}</span>
              )}
            </button>
          ))}
        </div>

        <div id="tab-dashboard" className="tab-panel" style={{ display: activeTab === 'dashboard' ? '' : 'none' }}>
          {activeTab === 'dashboard' && <DashboardTab />}
        </div>
        <div id="tab-products" className="tab-panel" style={{ display: activeTab === 'products' ? '' : 'none' }}>
          {activeTab === 'products' && <ProductsTab />}
        </div>
        <div id="tab-promo" className="tab-panel" style={{ display: activeTab === 'promo' ? '' : 'none' }}>
          {activeTab === 'promo' && <PromoTab />}
        </div>
        <div id="tab-orders" className="tab-panel" style={{ display: activeTab === 'orders' ? '' : 'none' }}>
          {activeTab === 'orders' && <OrdersTab />}
        </div>
        <div id="tab-settings" className="tab-panel" style={{ display: activeTab === 'settings' ? '' : 'none' }}>
          {activeTab === 'settings' && <SettingsTab />}
        </div>
      </main>
    </div>
  );
}

function AppShell() {
  const { session } = useAuth();
  if (session === undefined) return null; // brief loading check, no original equivalent to flash
  return (
    <>
      <FaviconSync />
      {session ? <Dashboard /> : <LoginScreen />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ConfirmDialogProvider>
        <AppShell />
      </ConfirmDialogProvider>
    </AuthProvider>
  );
}
