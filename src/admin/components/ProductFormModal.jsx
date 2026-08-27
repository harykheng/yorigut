import { useEffect, useState } from 'react';
import Modal from '../../shared/components/Modal.jsx';
import ImageUploadDropzone from './ImageUploadDropzone.jsx';
import { useToast } from '../../shared/components/Toast.jsx';
import { saveProduct } from '../../shared/lib/products.js';

const EMPTY_FORM = {
  name: '', description: '', price: '', stockQty: '',
  isNew: false, isBestseller: false, isVisible: true,
  variantGroups: [],
};

export default function ProductFormModal({ isOpen, product, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [imageFile, setImageFile] = useState(null);
  const [existingImageUrl, setExistingImageUrl] = useState(null);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (!isOpen) return;
    if (product) {
      setForm({
        name: product.name,
        description: product.description || '',
        price: product.price,
        stockQty: product.stock_qty == null ? '' : product.stock_qty,
        isNew: product.is_new,
        isBestseller: product.is_bestseller,
        isVisible: product.is_visible,
        variantGroups: (product.variants || []).map((g) => ({ name: g.name, options: g.options.map((o) => ({ label: o.label, price: o.price || 0 })) })),
      });
      setExistingImageUrl(product.image_url || null);
    } else {
      setForm(EMPTY_FORM);
      setExistingImageUrl(null);
    }
    setImageFile(null);
  }, [isOpen, product]);

  function addVariantGroup() {
    setForm((f) => ({ ...f, variantGroups: [...f.variantGroups, { name: '', options: [{ label: '', price: 0 }] }] }));
  }

  function removeVariantGroup(gi) {
    setForm((f) => ({ ...f, variantGroups: f.variantGroups.filter((_, i) => i !== gi) }));
  }

  function updateGroupName(gi, name) {
    setForm((f) => ({ ...f, variantGroups: f.variantGroups.map((g, i) => (i === gi ? { ...g, name } : g)) }));
  }

  function addOption(gi) {
    setForm((f) => ({
      ...f,
      variantGroups: f.variantGroups.map((g, i) => (i === gi ? { ...g, options: [...g.options, { label: '', price: 0 }] } : g)),
    }));
  }

  function removeOption(gi, oi) {
    setForm((f) => ({
      ...f,
      variantGroups: f.variantGroups.map((g, i) => (i === gi ? { ...g, options: g.options.filter((_, j) => j !== oi) } : g)),
    }));
  }

  function updateOption(gi, oi, field, value) {
    setForm((f) => ({
      ...f,
      variantGroups: f.variantGroups.map((g, i) =>
        i === gi ? { ...g, options: g.options.map((o, j) => (j === oi ? { ...o, [field]: value } : o)) } : g
      ),
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const variants = form.variantGroups
        .filter((g) => g.name.trim())
        .map((g) => ({
          name: g.name.trim(),
          options: g.options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), price: parseInt(o.price, 10) || 0 })),
        }))
        .filter((g) => g.options.length > 0);

      await saveProduct({
        productId: product?.id || null,
        name: form.name.trim(),
        description: form.description.trim(),
        price: parseInt(form.price, 10),
        stockQty: form.stockQty === '' ? null : parseInt(form.stockQty, 10),
        isNew: form.isNew,
        isBestseller: form.isBestseller,
        isVisible: form.isVisible,
        variants,
        imageFile,
        existingImageUrl,
      });

      showToast(product ? 'Produk berhasil diperbarui! ✅' : 'Produk berhasil ditambahkan! ✅', 'success');
      onSaved();
      onClose();
    } catch (err) {
      console.error('Save product error:', err);
      showToast('Gagal menyimpan: ' + (err.message || 'Coba lagi'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={product ? 'Edit Produk' : 'Tambah Produk'} boxClassName="" overlayClassName="product-form">
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="productName">Nama Produk *</label>
          <input
            type="text" id="productName" placeholder="Contoh: Kopi Latte Susu" required
            value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>

        <div className="form-group">
          <label htmlFor="productDescription">Deskripsi <span style={{ fontWeight: 500, color: 'var(--text-soft)' }}>(opsional)</span></label>
          <textarea
            id="productDescription" rows={2} placeholder="Contoh: Espresso + susu oat, tersedia hot/iced"
            value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>

        <div className="form-group">
          <label htmlFor="productPrice">Harga (Rp) *</label>
          <input
            type="number" id="productPrice" placeholder="45000" min="0" step="500" required
            value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          />
        </div>

        <div className="form-group">
          <label htmlFor="productStock">Stok <span style={{ fontWeight: 500, color: 'var(--text-soft)' }}>(opsional)</span></label>
          <input
            type="number" id="productStock" placeholder="Kosongkan = tidak dibatasi" min="0" step="1"
            value={form.stockQty} onChange={(e) => setForm((f) => ({ ...f, stockQty: e.target.value }))}
          />
          <p className="form-hint">Otomatis berkurang tiap ada pesanan masuk. Kosongkan kalau stoknya selalu tersedia.</p>
        </div>

        <div className="form-group">
          <label>Foto Produk</label>
          <ImageUploadDropzone
            existingUrl={existingImageUrl}
            onFileSelect={setImageFile}
            onRemove={() => { setImageFile(null); setExistingImageUrl(null); }}
            maxSizeMB={5}
            hint="JPG/PNG/WEBP persegi (1:1), disarankan 800×800px — Maks 5 MB"
          />
        </div>

        <div className="form-group">
          <label>Badge &amp; Visibilitas</label>
          <div className="toggle-group">
            <div className="toggle-item">
              <div className="toggle-label">
                <span className="toggle-label-title">✨ Badge "New"</span>
                <span className="toggle-label-sub">Tampilkan label baru di kartu produk</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={form.isNew} onChange={(e) => setForm((f) => ({ ...f, isNew: e.target.checked }))} />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="toggle-item">
              <div className="toggle-label">
                <span className="toggle-label-title">⭐ Badge "Terlaris"</span>
                <span className="toggle-label-sub">Tampilkan label terlaris di kartu produk</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={form.isBestseller} onChange={(e) => setForm((f) => ({ ...f, isBestseller: e.target.checked }))} />
                <span className="toggle-slider"></span>
              </label>
            </div>
            <div className="toggle-item">
              <div className="toggle-label">
                <span className="toggle-label-title">👁️ Tampilkan di Katalog</span>
                <span className="toggle-label-sub">Matikan untuk sembunyikan sementara</span>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={form.isVisible} onChange={(e) => setForm((f) => ({ ...f, isVisible: e.target.checked }))} />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <div className="form-group">
          <div className="variant-builder-header">
            <label style={{ marginBottom: 0 }}>Varian Produk <span style={{ fontWeight: 500, color: 'var(--text-soft)' }}>(opsional)</span></label>
            <button type="button" className="btn-add-variant-group" onClick={addVariantGroup}>+ Tambah Varian</button>
          </div>
          <p className="form-hint" style={{ marginTop: 4, marginBottom: 10 }}>Contoh: Ukuran (S/M/L), Suhu (Hot/Iced)</p>
          <div>
            {form.variantGroups.map((group, gi) => (
              <div className="variant-group" key={gi}>
                <div className="variant-group-head">
                  <input
                    type="text" className="variant-group-name form-input" placeholder="Nama varian (contoh: Ukuran)"
                    value={group.name} onChange={(e) => updateGroupName(gi, e.target.value)}
                  />
                  <button type="button" className="variant-group-del" onClick={() => removeVariantGroup(gi)}>✕</button>
                </div>
                <div className="variant-opts-list">
                  {group.options.map((opt, oi) => (
                    <div className="variant-opt-row" key={oi}>
                      <input
                        type="text" className="variant-opt-label form-input" placeholder="Nama opsi (contoh: Medium)"
                        value={opt.label} onChange={(e) => updateOption(gi, oi, 'label', e.target.value)}
                      />
                      <div className="variant-opt-price-wrap">
                        <span className="variant-opt-plus">+Rp</span>
                        <input
                          type="number" className="variant-opt-price form-input" placeholder="0" min="0" step="500"
                          value={opt.price} onChange={(e) => updateOption(gi, oi, 'price', e.target.value)}
                        />
                      </div>
                      <button type="button" className="variant-opt-del" onClick={() => removeOption(gi, oi)}>✕</button>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn-add-variant-opt" onClick={() => addOption(gi)}>+ Tambah Opsi</button>
              </div>
            ))}
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Batal</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan Produk'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
