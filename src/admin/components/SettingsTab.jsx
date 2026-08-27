import { useEffect, useState } from 'react';
import { useSettings } from '../../shared/hooks/useSettings.js';
import { useToast } from '../../shared/components/Toast.jsx';
import { saveSettings } from '../../shared/lib/settings.js';
import ImageUploadDropzone from './ImageUploadDropzone.jsx';

const EMPTY_FORM = {
  brandName: '', brandIcon: '☕', storeAddress: '', storeHours: '', storeMapsUrl: '',
  bannerTitle: '', bannerSubtitle: '', instagramUrl: '', tiktokUrl: '',
};

export default function SettingsTab() {
  const { settings, loading, refetch } = useSettings();
  const showToast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [logoFile, setLogoFile] = useState(null);
  const [existingLogoUrl, setExistingLogoUrl] = useState(null);
  const [logoTextFile, setLogoTextFile] = useState(null);
  const [existingLogoTextUrl, setExistingLogoTextUrl] = useState(null);
  const [bannerImageFile, setBannerImageFile] = useState(null);
  const [existingBannerImageUrl, setExistingBannerImageUrl] = useState(null);
  const [faviconFile, setFaviconFile] = useState(null);
  const [existingFaviconUrl, setExistingFaviconUrl] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      brandName: settings.brand_name || '',
      brandIcon: settings.brand_icon || '☕',
      storeAddress: settings.store_address || '',
      storeHours: settings.store_hours || '',
      storeMapsUrl: settings.store_maps_url || '',
      bannerTitle: settings.banner_title || '',
      bannerSubtitle: settings.banner_subtitle || '',
      instagramUrl: settings.instagram_url || '',
      tiktokUrl: settings.tiktok_url || '',
    });
    setExistingLogoUrl(settings.logo_url || null);
    setExistingLogoTextUrl(settings.logo_text_url || null);
    setExistingBannerImageUrl(settings.banner_image_url || null);
    setExistingFaviconUrl(settings.favicon_url || null);
  }, [settings]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await saveSettings({
        brandName: form.brandName.trim(),
        brandIcon: form.brandIcon.trim(),
        storeAddress: form.storeAddress.trim(),
        storeHours: form.storeHours.trim(),
        storeMapsUrl: form.storeMapsUrl.trim(),
        bannerTitle: form.bannerTitle.trim(),
        bannerSubtitle: form.bannerSubtitle.trim(),
        instagramUrl: form.instagramUrl.trim(),
        tiktokUrl: form.tiktokUrl.trim(),
        logoFile,
        logoTextFile,
        bannerImageFile,
        faviconFile,
        existingLogoUrl,
        existingLogoTextUrl,
        existingBannerImageUrl,
        existingFaviconUrl,
      });
      setLogoFile(null);
      setLogoTextFile(null);
      setBannerImageFile(null);
      setFaviconFile(null);
      showToast('Pengaturan berhasil disimpan! ✅', 'success');
      await refetch();
    } catch (err) {
      console.error('Save settings error:', err);
      showToast('Gagal menyimpan: ' + (err.message || 'Coba lagi'), 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-state" style={{ display: 'flex' }}>
        <div className="spinner"></div>
        <span>Memuat pengaturan...</span>
      </div>
    );
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h2 className="admin-page-title">Pengaturan</h2>
          <p className="admin-page-subtitle">Tampilan website &amp; brand</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="settings-form" noValidate>
        <div className="settings-section">
          <div className="settings-section-title">Brand</div>
          <div className="form-group">
            <label htmlFor="settingBrandName">Nama Brand</label>
            <input type="text" id="settingBrandName" placeholder="Nama Toko Kamu" maxLength={40} value={form.brandName} onChange={(e) => setForm((f) => ({ ...f, brandName: e.target.value }))} />
          </div>
          <div className="form-group">
            <label htmlFor="settingBrandIcon">Ikon / Emoji</label>
            <input type="text" id="settingBrandIcon" placeholder="☕" maxLength={4} style={{ maxWidth: 90 }} value={form.brandIcon} onChange={(e) => setForm((f) => ({ ...f, brandIcon: e.target.value }))} />
            <p className="form-hint">Tampil di header kalau tidak ada logo gambar</p>
          </div>
          <div className="form-group">
            <label>Logo Ikon (Gambar — opsional)</label>
            <ImageUploadDropzone
              existingUrl={existingLogoUrl}
              onFileSelect={setLogoFile}
              onRemove={() => { setLogoFile(null); setExistingLogoUrl(null); }}
              maxSizeMB={2}
              hint="PNG/JPG/WEBP persegi (1:1), disarankan 256×256px — Maks 2 MB"
            />
            <p className="form-hint">Mascot/ikon kecil di header. Tampil kalau tidak ada logo ikon, fallback ke emoji di atas.</p>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Logo Teks / Wordmark (Gambar — opsional)</label>
            <ImageUploadDropzone
              existingUrl={existingLogoTextUrl}
              onFileSelect={setLogoTextFile}
              onRemove={() => { setLogoTextFile(null); setExistingLogoTextUrl(null); }}
              maxSizeMB={2}
              hint="PNG transparan landscape, disarankan 500×100px (rasio ~5:1) — Maks 2 MB"
            />
            <p className="form-hint">Ganti tulisan "Nama Brand" di header dengan gambar logo teks kamu sendiri. Kalau kosong, tampil sebagai teks biasa.</p>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Favicon</div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Ikon Tab Browser (opsional)</label>
            <ImageUploadDropzone
              existingUrl={existingFaviconUrl}
              onFileSelect={setFaviconFile}
              onRemove={() => { setFaviconFile(null); setExistingFaviconUrl(null); }}
              maxSizeMB={1}
              hint="PNG persegi (1:1), disarankan 512×512px — Maks 1 MB"
            />
            <p className="form-hint">Tampil di tab browser untuk katalog, admin, dan lacak pesanan. Kalau kosong, pakai favicon default bawaan template.</p>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Informasi Toko</div>
          <div className="form-group">
            <label htmlFor="settingStoreAddress">Alamat Pickup</label>
            <textarea id="settingStoreAddress" rows={3} placeholder="Jl. Contoh No.1, Kota..." value={form.storeAddress} onChange={(e) => setForm((f) => ({ ...f, storeAddress: e.target.value }))} />
          </div>
          <div className="form-group">
            <label htmlFor="settingStoreHours">Jam Operasional</label>
            <input type="text" id="settingStoreHours" placeholder="Senin – Minggu, 08.00 – 21.00 WIB" value={form.storeHours} onChange={(e) => setForm((f) => ({ ...f, storeHours: e.target.value }))} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="settingStoreMapsUrl">Link Google Maps</label>
            <input type="url" id="settingStoreMapsUrl" placeholder="https://maps.google.com/..." value={form.storeMapsUrl} onChange={(e) => setForm((f) => ({ ...f, storeMapsUrl: e.target.value }))} />
            <p className="form-hint">URL yang terbuka saat pelanggan tap "Lihat di Maps"</p>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Banner Katalog</div>
          <div className="form-group">
            <label>Foto Banner (opsional)</label>
            <ImageUploadDropzone
              existingUrl={existingBannerImageUrl}
              onFileSelect={setBannerImageFile}
              onRemove={() => { setBannerImageFile(null); setExistingBannerImageUrl(null); }}
              maxSizeMB={5}
              hint="JPG/PNG/WEBP landscape, disarankan 1200×500px (rasio ~2.4:1) — Maks 5 MB"
            />
            <p className="form-hint">Tampil sebagai foto background di banner katalog</p>
          </div>
          <div className="form-group">
            <label htmlFor="settingBannerTitle">Judul Banner</label>
            <input type="text" id="settingBannerTitle" placeholder="Ada yang baru nih! ✨" value={form.bannerTitle} onChange={(e) => setForm((f) => ({ ...f, bannerTitle: e.target.value }))} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="settingBannerSub">Subjudul Banner</label>
            <input type="text" id="settingBannerSub" placeholder="Cek semua menu terbaru" value={form.bannerSubtitle} onChange={(e) => setForm((f) => ({ ...f, bannerSubtitle: e.target.value }))} />
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">Social Media</div>
          <div className="form-group">
            <label htmlFor="settingInstagramUrl">Instagram</label>
            <input type="url" id="settingInstagramUrl" placeholder="https://instagram.com/tokomu" value={form.instagramUrl} onChange={(e) => setForm((f) => ({ ...f, instagramUrl: e.target.value }))} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="settingTiktokUrl">TikTok</label>
            <input type="url" id="settingTiktokUrl" placeholder="https://tiktok.com/@tokomu" value={form.tiktokUrl} onChange={(e) => setForm((f) => ({ ...f, tiktokUrl: e.target.value }))} />
          </div>
        </div>

        <div className="form-actions settings-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
          </button>
        </div>
      </form>
    </div>
  );
}
