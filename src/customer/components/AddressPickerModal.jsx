import { useEffect, useRef, useState } from 'react';
import { config } from '../../shared/lib/config.js';
import { useBodyScrollLock } from '../../shared/hooks/useBodyScrollLock.js';
import { haversineDistance } from '../../shared/lib/shipping.js';
import AddressMapPreview from './AddressMapPreview.jsx';

async function fetchSuggestions(q) {
  try {
    const params = new URLSearchParams({
      key: config.locationIqKey,
      q,
      limit: '8',
      dedupe: '1',
      'accept-language': 'id',
      countrycodes: 'id',
    });

    const hasStoreCoords = Number.isFinite(config.storeLat) && Number.isFinite(config.storeLng);

    // Bias results toward the store's area so e.g. searching "Taman Anggrek"
    // from a Jakarta store surfaces the Jakarta one first, not a same-named
    // place in another city. viewbox + bounded=0 is a soft bias (LocationIQ
    // still returns better matches outside the box), not a hard filter —
    // bounded=1 would hide a legitimately farther-out address entirely if
    // the box size ever doesn't match reality.
    if (hasStoreCoords) {
      const delta = 0.5; // ~55km box around the store
      params.set(
        'viewbox',
        `${config.storeLng - delta},${config.storeLat + delta},${config.storeLng + delta},${config.storeLat - delta}`
      );
      params.set('bounded', '0');
    }

    const url = `https://api.locationiq.com/v1/autocomplete?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const results = await res.json();
    if (!Array.isArray(results)) return results;

    // viewbox only biases LocationIQ's own relevance ranking (text match +
    // proximity mixed together) — it doesn't guarantee nearest-first order.
    // Re-sort by actual distance to the store so the closest result is
    // always first, regardless of how LocationIQ ranked it internally.
    if (hasStoreCoords) {
      results.sort((a, b) =>
        haversineDistance(config.storeLat, config.storeLng, parseFloat(a.lat), parseFloat(a.lon)) -
        haversineDistance(config.storeLat, config.storeLng, parseFloat(b.lat), parseFloat(b.lon))
      );
    }

    return results;
  } catch {
    return []; // silent — customer can still search again
  }
}

// Full-screen address picker, opened by tapping the address summary card in
// ProfileModal — replaces the old cramped in-sheet dropdown+map. Two internal
// steps: search (full-screen results list) then confirm (bigger map preview +
// the catatan alamat field), landing back on ProfileModal only once "Simpan
// Alamat Ini" is tapped. Nothing here touches CartContext directly — the
// picked address/coords/note are only reported up via onConfirm.
export default function AddressPickerModal({ isOpen, onClose, onConfirm, initialAddress, initialNote }) {
  const [step, setStep] = useState('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState('');
  const timerRef = useRef(null);
  const inputRef = useRef(null);
  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    setStep('search');
    setQuery(initialAddress || '');
    setResults([]);
    setSelected(null);
    setNote(initialNote || '');
    // Autofocus the search field as the sheet opens, matching how a tap on
    // the address card is meant to jump straight into typing.
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function handleSearchInput(e) {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(timerRef.current);
    if (q.trim().length < 3) { setResults([]); setSearching(false); return; }
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      const data = await fetchSuggestions(q);
      setResults(data);
      setSearching(false);
    }, 350);
  }

  function pickResult(r) {
    const label = r.display_name || r.display_place || '';
    setSelected({ label, lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
    setStep('confirm');
  }

  function handleConfirmSave() {
    if (!selected) return;
    onConfirm(selected.label, selected.lat, selected.lng, note.trim());
  }

  if (!isOpen) return null;

  return (
    // Rendered as a sibling of .profile-sheet inside ProfileModal's
    // .profile-overlay, which closes the whole sheet on any click that
    // bubbles to it — stopPropagation here so interacting with the picker
    // doesn't accidentally close the profile sheet underneath it.
    <div className="address-picker-overlay" onClick={(e) => e.stopPropagation()}>
      {step === 'search' ? (
        <>
          <header className="address-picker-header">
            <button className="address-picker-back" onClick={onClose} aria-label="Tutup">←</button>
            <span className="address-picker-title">Pilih Alamat</span>
            <span style={{ width: 36 }}></span>
          </header>
          <div className="address-picker-search-wrap">
            <input
              ref={inputRef}
              type="text"
              className="address-picker-search-input"
              placeholder="Cari alamat, jalan, gedung..."
              value={query}
              onChange={handleSearchInput}
            />
          </div>
          <div className="address-picker-results">
            {searching && <div className="address-picker-status">Mencari...</div>}
            {!searching && query.trim().length >= 3 && results.length === 0 && (
              <div className="address-picker-status">Alamat tidak ditemukan, coba kata kunci lain</div>
            )}
            {!searching && query.trim().length < 3 && (
              <div className="address-picker-status">Ketik minimal 3 huruf untuk mulai cari</div>
            )}
            {results.map((r, i) => {
              const title = (r.display_place || r.display_name || '').split(',')[0];
              return (
                <div key={i} className="address-picker-result-item" onClick={() => pickResult(r)}>
                  <span className="address-picker-result-icon">📍</span>
                  <div>
                    <div className="address-picker-result-title">{title}</div>
                    <div className="address-picker-result-sub">{r.display_name}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <header className="address-picker-header">
            <button className="address-picker-back" onClick={() => setStep('search')} aria-label="Kembali">←</button>
            <span className="address-picker-title">Konfirmasi Lokasi</span>
            <span style={{ width: 36 }}></span>
          </header>
          <div className="address-picker-confirm-body">
            <div className="address-picker-selected-card">
              <span className="address-picker-result-icon">📍</span>
              <span>{selected?.label}</span>
            </div>
            <AddressMapPreview lat={selected?.lat} lng={selected?.lng} large />
            <div className="form-group" style={{ marginTop: 16 }}>
              <label htmlFor="addressPickerNote">Catatan Alamat <span className="label-opt">(opsional)</span></label>
              <input
                type="text"
                id="addressPickerNote"
                placeholder="No. unit, lantai, patokan, kode gate..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <div className="address-picker-footer">
            <button className="btn-profile-save" onClick={handleConfirmSave}>Simpan Alamat Ini</button>
          </div>
        </>
      )}
    </div>
  );
}
