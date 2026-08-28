# Ordi Master — Setup Guide

Website e-commerce untuk UMKM (template multi-klien). Stack: **React + Vite**, Supabase (database + auth + storage), deploy ke Vercel/Netlify/Cloudflare — project ini sendiri jalan di **Cloudflare** (Workers, static assets lewat `wrangler.jsonc`). Hampir semua logic (QRIS, promo, dsb) jalan di browser tanpa backend server — satu-satunya pengecualian adalah cek ongkir real-time, yang lewat 1 Supabase Edge Function kecil karena butuh menyembunyikan API key Biteship.

Tiga aplikasi React terpisah dalam satu repo (Vite multi-page app): katalog customer di `/`, dashboard admin di `/admin/`, lacak pesanan di `/tracking/`. Masing-masing punya bundle sendiri — customer tidak pernah men-download kode dashboard admin dan sebaliknya.

**Fitur utama:**
- Katalog produk dengan varian (ukuran, suhu, dll), badge (New/Terlaris), dan stok opsional (badge "Habis" otomatis + anti-oversell)
- Lacak status pesanan tanpa perlu akun (`/tracking/`) — customer cukup masukin kode pesanan + nomor WhatsApp
- Checkout Pickup & Delivery, dengan alamat autocomplete (LocationIQ) dan ongkir real-time (Biteship — GoSend/GrabExpress), fallback ke tarif jarak statis kalau Biteship tidak tersedia
- Kode promo (persen / nominal, minimum order, tanggal expired)
- Pembayaran QRIS dinamis — nominal digenerate langsung di browser dari QRIS statis toko, tanpa payment gateway/API berbayar
- Konfirmasi pesanan otomatis terkirim ke WhatsApp admin, tersimpan di database sebagai status `pending`
- Dashboard admin: kelola produk, promo, pesanan (ubah status, print label, kirim ringkasan ke WA customer, export CSV), notifikasi pesanan baru live, dan pengaturan brand/toko

---

## 1. Setup Supabase

### Buat Project Supabase

1. Buka [supabase.com](https://supabase.com) → **New Project**
2. Isi nama project, database password, pilih region terdekat (Singapore)
3. Tunggu project selesai dibuat (~2 menit)

### Buat Tabel

Di sidebar Supabase, buka **SQL Editor** → klik **New Query**, paste SQL di bawah ini satu per satu (atau sekaligus) lalu klik **Run**.

#### `products` — Daftar produk

```sql
CREATE TABLE products (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT        NOT NULL,
  description   TEXT,
  price         INTEGER     NOT NULL CHECK (price >= 0),
  image_url     TEXT,
  is_new        BOOLEAN     NOT NULL DEFAULT false,
  is_bestseller BOOLEAN     NOT NULL DEFAULT false,
  is_visible    BOOLEAN     NOT NULL DEFAULT true,
  variants      JSONB       DEFAULT '[]'::jsonb,
  stock_qty     INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read visible products"
  ON products FOR SELECT TO anon USING (is_visible = true);

CREATE POLICY "Admin read all products"
  ON products FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin insert products"
  ON products FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Admin update products"
  ON products FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Admin delete products"
  ON products FOR DELETE TO authenticated USING (true);
```

> `variants` menyimpan array grup varian, misalnya `[{ "name": "Ukuran", "options": [{ "label": "S", "extraPrice": 0 }, { "label": "L", "extraPrice": 5000 }] }]`. Diisi lewat form admin, opsional.

> `stock_qty` — `NULL` berarti stok tidak dilacak (produk selalu tersedia, ini default-nya). Diisi angka kalau stoknya terbatas; otomatis dikurangi tiap ada pesanan masuk lewat function `place_order()` (lihat bagian `orders` di bawah), dan katalog customer otomatis nampilin badge "Habis" begitu stoknya 0.

#### `promo_codes` — Kode promo

```sql
CREATE TABLE promo_codes (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  code           TEXT        NOT NULL UNIQUE,
  discount_type  TEXT        NOT NULL CHECK (discount_type IN ('percent', 'flat')),
  discount_value INTEGER     NOT NULL CHECK (discount_value > 0),
  min_order      INTEGER     NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

-- Customer hanya bisa baca promo yang aktif (untuk validasi kode saat checkout)
CREATE POLICY "Public read active promo"
  ON promo_codes FOR SELECT TO anon USING (is_active = true);

CREATE POLICY "Admin full access promo"
  ON promo_codes FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

#### `settings` — Pengaturan brand & toko (single row, id selalu 1)

```sql
CREATE TABLE settings (
  id               INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  brand_name       TEXT,
  brand_icon       TEXT,
  logo_url         TEXT,
  logo_text_url    TEXT,
  favicon_url      TEXT,
  store_address    TEXT,
  store_hours      TEXT,
  store_maps_url   TEXT,
  banner_title     TEXT,
  banner_subtitle  TEXT,
  banner_image_url TEXT,
  instagram_url    TEXT,
  tiktok_url       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read settings"
  ON settings FOR SELECT TO anon USING (true);

CREATE POLICY "Admin full access settings"
  ON settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

> Kalau tabel ini belum dibuat / kosong, website otomatis fallback ke nilai default di `js/config.js` — jadi tidak wajib diisi langsung, tapi disarankan agar admin bisa ganti dari dashboard tanpa edit kode.

#### `orders` — Pesanan masuk

```sql
CREATE TABLE orders (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number      TEXT        NOT NULL UNIQUE,
  customer_name     TEXT        NOT NULL,
  customer_wa       TEXT        NOT NULL,
  order_type        TEXT        NOT NULL CHECK (order_type IN ('pickup', 'delivery')),
  order_date        DATE        NOT NULL,
  order_date_label  TEXT,
  delivery_address  TEXT,
  note              TEXT,
  items             JSONB       NOT NULL,
  subtotal          INTEGER     NOT NULL,
  promo_code        TEXT,
  discount_amount   INTEGER     NOT NULL DEFAULT 0,
  shipping_cost     INTEGER,
  shipping_label    TEXT,
  total             INTEGER     NOT NULL,
  qris_string       TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'confirmed', 'done', 'cancelled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Customer (anon) hanya bisa MEMBUAT pesanan, tidak bisa membaca pesanan siapapun
-- (mencegah orang lain mengintip nama/nomor WA/alamat customer lain)
CREATE POLICY "Public insert orders"
  ON orders FOR INSERT TO anon WITH CHECK (true);

-- Admin (login) bisa baca & ubah semua pesanan
CREATE POLICY "Admin full access orders"
  ON orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

> `qris_string` menyimpan QRIS dinamis (hasil generate dari QRIS statis toko + nominal) supaya admin/customer bisa menampilkan ulang QR-nya kapan saja lewat tombol "Tampilkan QR lagi" — ini bukan kredensial rahasia, aman disimpan apa adanya.

#### `place_order()` — insert order + kurangi stok, dalam satu transaksi

Frontend **tidak** insert langsung ke `orders` — semua checkout lewat `supabase.rpc('place_order', { order_data, stock_items })`. Alasannya: cek-lalu-kurangi stok dari browser punya race condition kalau 2 customer checkout produk yang sama nyaris bersamaan. Function Postgres ini mengurangi `stock_qty` tiap item (gagal & rollback semuanya kalau ada satu item yang stoknya kurang — order pun tidak jadi ke-insert) dan insert order-nya, semua dalam satu transaksi atomic. Produk dengan `stock_qty NULL` dianggap tak terbatas, tidak pernah gagal/dikurangi.

Definisi lengkapnya ada di `supabase-setup.sql` §6 — copy dari situ kalau setup manual satu-satu, jangan ditulis ulang manual di sini (biar tidak drift).

#### `lookup_order()` — cek status pesanan tanpa login

Dipakai halaman `/tracking/`. Karena `orders` RLS sengaja insert-only untuk `anon` (lihat catatan di atas), customer tidak pernah dikasih SELECT langsung ke tabel ini — function ini jadi satu-satunya jalan cek status, dan cuma balikin 1 baris kalau kode pesanan **dan** nomor WhatsApp-nya cocok berbarengan. Definisi lengkapnya ada di `supabase-setup.sql` §7.

#### `track_visit()` — hitung pengunjung katalog per hari

Halaman katalog customer (`/`) manggil `supabase.rpc('track_visit')` sekali per sesi tab (`sessionStorage`, bukan tiap render/refresh) lewat `src/shared/lib/visits.js`. Function ini upsert satu baris counter per tanggal ke tabel `daily_visits` (`count = count + 1`, atomic — bukan satu baris per kunjungan, biar tabelnya tidak tumbuh tak terbatas). `daily_visits` tidak punya policy SELECT untuk `anon`, cuma admin (login) yang bisa baca lewat tab **Dashboard** (chart "Pengunjung 7 Hari Terakhir"). Definisi lengkapnya ada di `supabase-setup.sql` §12.

#### Realtime — notifikasi pesanan baru live di dashboard admin

Opsional, tapi disarankan. Tanpa ini dashboard tetap jalan normal (cuma harus refresh manual buat lihat pesanan baru). Aktifkan lewat SQL Editor:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
```

(Sudah termasuk otomatis kalau jalankan `supabase-setup.sql` §6 dari awal — cuma perlu dijalankan manual kalau setup satu-satu, atau kalau instance-nya dibuat sebelum fitur ini ada.) Alternatif tanpa SQL: Supabase Dashboard → **Database** → **Replication** → centang tabel `orders`.

### Buat Storage Bucket untuk Foto

1. Di sidebar Supabase, buka **Storage** → **New bucket**
2. Nama bucket: `product-images`
3. Centang **Public bucket** (agar foto bisa dilihat pengunjung)
4. Klik **Create bucket**

Bucket ini dipakai untuk foto produk, logo brand, dan foto banner katalog. Tambahkan ke-4 policy berikut via **SQL Editor** — jangan cuma insert/delete, `Public read images` dan `Admin update images` juga wajib ada (yang terakhir itu dibutuhkan upload dengan `upsert: true`, dipakai SettingsTab untuk logo/banner — lihat catatan RLS drift di `CLAUDE.md` kalau upload logo/banner gagal padahal upload foto produk normal):

```sql
CREATE POLICY "Public read images"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'product-images');

CREATE POLICY "Admin upload images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "Admin delete images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images');

CREATE POLICY "Admin update images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images');
```

### Buat Akun Admin

Ada 2 cara:

**A. Set password langsung (paling gampang, tanpa setup tambahan)**
1. Di sidebar Supabase, buka **Authentication** → **Users**
2. Klik **Add user** → **Create new user**
3. Isi email dan password yang akan dipakai untuk login ke `/admin/`

**B. Kirim link undangan lewat email**
1. Di sidebar Supabase, buka **Authentication** → **URL Configuration**, pastikan Site URL (atau Redirect URLs) mengarah ke domain kamu (mis. `https://tokokamu.com`)
2. **Authentication** → **Users** → **Add user** → **Invite user**, isi emailnya
3. Admin buka email undangan dan klik link — otomatis diarahkan ke `/admin/` dan muncul halaman "Buat Password" (bukan Dashboard langsung), isi password baru sekali, langsung masuk

Kalau link undangan gak diklik dalam 24 jam, linknya expired — kirim ulang dari **Authentication** → **Users**.

---

## 2. Konfigurasi Website

Install dependencies dan siapkan environment variables:

```bash
npm install
cp .env.example .env
```

Buka file `.env` dan sesuaikan:

```bash
# Wajib diisi
VITE_SUPABASE_URL=https://XXXXXXXXXXXXXXXX.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
VITE_ADMIN_WHATSAPP=6281234567890   # format: 62 + nomor tanpa angka 0 di depan

# Default brand/toko — bisa dioverride dari Admin > Pengaturan setelah tabel `settings` dibuat
VITE_STORE_NAME=Nama Toko Kamu
VITE_STORE_ADDRESS=Jl. Contoh No.1, Kota...
VITE_STORE_MAPS_URL=https://maps.google.com/...   # link share Google Maps, bukan API
VITE_STORE_OPEN_HOURS=Senin – Minggu, 08.00 – 21.00 WIB
VITE_BANNER_TITLE=Ada yang baru nih! ✨
VITE_BANNER_SUBTITLE=Cek semua menu terbaru
VITE_INSTAGRAM_URL=https://instagram.com/tokomu
VITE_TIKTOK_URL=https://tiktok.com/@tokomu

# Autocomplete alamat pengiriman (LocationIQ, gratis untuk skala UMKM)
# Daftar di https://locationiq.com untuk dapat API key
VITE_LOCATIONIQ_KEY=pk.xxxxxxxxxxxxxxxxxxxx

# Koordinat toko — dipakai sebagai titik asal pengecekan ongkir, dan fallback
# tarif jarak statis (Haversine) kalau Biteship gagal/tidak tersedia
VITE_STORE_LAT=-6.2308
VITE_STORE_LNG=106.6480

# Estimasi berat per item (gram) untuk hitung ongkir Biteship — produk di sini
# tidak nyimpen berat per-produk, jadi dipakai angka rata-rata per pesanan
VITE_DEFAULT_ITEM_WEIGHT_G=300

# QRIS statis merchant — dari bank/GoPay/OVO/QRIS toko, biasanya di stiker QRIS fisik.
# Nominal dinamis digenerate otomatis di browser saat checkout, tidak butuh payment gateway.
VITE_QRIS_STATIC=00020101021126610014COM...
```

**Cara dapat URL & Anon Key Supabase:**
Supabase Dashboard → **Project Settings** → **API** → salin **Project URL** dan **anon public** key.

Jalankan lokal dengan `npm run dev` (buka `localhost:5173` untuk katalog, `localhost:5173/admin/` untuk dashboard admin).

> Tidak ada `BITESHIP_API_KEY` di `.env` — key Biteship itu secret dan cuma pernah hidup di Supabase secrets (lihat §3), tidak pernah di kode frontend.

---

## 3. Setup Ongkir Real-time (Biteship)

Fitur cek ongkir GoSend/GrabExpress pakai [Biteship](https://biteship.com). Berbeda dari key lain di `.env`, **API key Biteship adalah secret** — tidak boleh ditaruh di kode frontend, jadi dipanggil lewat Supabase Edge Function (`supabase/functions/check-shipping`) yang jadi proxy. Frontend React cuma pernah manggil Edge Function ini, tidak ada jalur "panggil Biteship langsung dari browser" sama sekali di kode — jadi **Edge Function ini wajib dideploy** sebelum ongkir real-time bisa jalan (sebelum itu, otomatis fallback ke tarif jarak statis, checkout tetap jalan normal).

### Dapatkan API Key Biteship
1. Daftar/login ke [dashboard.biteship.com](https://dashboard.biteship.com/integrations)
2. Ambil **Auth Token** (diawali `biteship_test_...` untuk testing atau `biteship_live_...` untuk production)

> ⚠️ **Waspada saat paste key ini** (baik di `supabase secrets set` maupun di textarea "Manage secrets" dashboard Supabase) — copy-paste dari sumber tertentu (terutama dari PDF/dokumen atau textarea lain) bisa menyisipkan karakter newline literal di tengah key tanpa terlihat. Efeknya: Edge Function jalan tapi selalu gagal dengan `TypeError: Invalid header value` (bukan 401/403, tapi error waktu bikin HTTP header-nya). Ciri-cirinya di textarea dashboard: teks wrap di titik yang aneh/konsisten terlalu awal, beda dari word-wrap alami yang ngikutin lebar textarea. Kalau ragu, hapus lalu retype manual, atau cek panjang string-nya persis sama dengan yang di-copy.

### Deploy Edge Function
Butuh [Supabase CLI](https://supabase.com/docs/guides/cli) terinstall (`npm install -g supabase`):

```bash
supabase login
supabase link --project-ref XXXXXXXXXXXXXXXX   # project ref dari Supabase Dashboard URL
supabase functions deploy check-shipping
supabase secrets set BITESHIP_API_KEY=biteship_xxxxxxxxxxxxxxxxxxxx
```

Alternatif tanpa CLI: buka Supabase Dashboard → **Edge Functions** → **Deploy a new function**, paste isi `supabase/functions/check-shipping/index.ts`, lalu set secret `BITESHIP_API_KEY` di **Edge Functions → Manage secrets**.

### Fallback
Kalau Edge Function belum dideploy, atau Biteship gagal (API down, area tidak ter-cover kurir, dsb), otomatis fallback ke tarif jarak statis (Haversine, ≤3km/6km/10km) — jadi tidak wajib setup Biteship dulu sebelum bisa mulai jualan.

---

## 4. Deploy ke Vercel

1. Buka [vercel.com](https://vercel.com) → login dengan GitHub
2. Klik **Add New** → **Project** → pilih repository ini
3. Vercel otomatis detect Vite — **Build Command**: `vite build` (atau `npm run build`), **Output Directory**: `dist`
4. Tambahkan semua env var dari `.env` di **Project Settings → Environment Variables** (isi yang sama, untuk Production & Preview)
5. Klik **Deploy** — selesai!

**Alternatif Netlify:**
1. [netlify.com](https://netlify.com) → **Add new site** → **Import an existing project**
2. Pilih repo, **Build command**: `npm run build`, **Publish directory**: `dist`
3. Tambahkan env var yang sama di **Site Settings → Environment Variables**
4. Klik **Deploy site**

**Alternatif Cloudflare:**

Dashboard Cloudflare sekarang menggabungkan flow "Pages" ke dalam "Workers" (`Create application` → `Continue with GitHub`, bukan lagi form Pages terpisah). Karena itu, repo ini sudah menyertakan `wrangler.jsonc` yang mendeklarasikan deploy sebagai **static assets saja** (tanpa Worker script sama sekali) — supaya Wrangler langsung tahu cara deploy-nya, tanpa perlu coba "menebak" lewat parsing `vite.config.js` (yang bisa gagal, lihat catatan di bawah).

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Continue with GitHub** → pilih repo ini
2. **Build command**: `npm run build` (Deploy command boleh dibiarkan default `npx wrangler deploy` — akan otomatis baca `wrangler.jsonc`)
3. Tambahkan env var yang sama di **Settings → Environment variables** (untuk Production & Preview)
4. Kalau build gagal karena versi Node terlalu lama, tambah env var `NODE_VERSION` = `20`
5. Klik **Deploy**

> Kalau di dashboard kamu masih ada opsi **Pages** terpisah (link "Looking to deploy Pages? Get started"), itu juga bisa dipakai — sama-sama cuma build lalu upload folder `dist/` sebagai file statis, dan malah lebih simpel karena gak pernah nyentuh `wrangler.jsonc` sama sekali.

> Dashboard admin ada di `/admin/` (bukan lagi `/admin.html`) — ketiga platform di atas otomatis resolve `dist/admin/index.html` ke path `/admin/` (directory index resolution bawaan), jadi biasanya langsung jalan tanpa rewrite tambahan. Kalau ternyata 404, tambah satu baris rewrite (`vercel.json`/`netlify.toml`/`_redirects` tergantung platform) yang mengarahkan `/admin` ke `/admin/index.html`.

---

## 5. Struktur File

```
ordi-master/
├── index.html                ← Vite entry point aplikasi customer (root div + script module)
├── admin/
│   └── index.html            ← Vite entry point aplikasi admin, di-serve di /admin/
├── tracking/
│   └── index.html            ← Vite entry point halaman lacak pesanan, di-serve di /tracking/
├── src/
│   ├── customer/              ← Aplikasi React customer-facing
│   │   ├── main.jsx            ← Render root, import CSS
│   │   ├── App.jsx             ← CartProvider + step switcher + modal orchestration
│   │   ├── CartContext.jsx     ← State global order flow (cart, promo, shipping, profile) via useReducer
│   │   ├── components/         ← OrderTypeStep, CatalogStep, CheckoutStep, ProfileModal,
│   │   │                          QrisModal, OrderSummaryModal, VariantSheet, dll
│   │   └── hooks/               ← useShipping (Biteship Edge Function + fallback Haversine)
│   ├── admin/                  ← Aplikasi React admin dashboard
│   │   ├── main.jsx
│   │   ├── App.jsx              ← AuthProvider + tab shell
│   │   ├── AuthContext.jsx      ← Supabase Auth session state
│   │   └── components/          ← LoginScreen, ProductsTab/PromoTab/OrdersTab/SettingsTab,
│   │                               form modals, ImageUploadDropzone, PrintLabel
│   ├── tracking/                ← Aplikasi React lacak pesanan (lookup by kode + WA, tanpa akun)
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   └── components/           ← OrderStatusCard
│   └── shared/                  ← Dipakai ketiga aplikasi
│       ├── lib/                  ← Pure functions: qris.js (crc16/qrisToDynamic), shipping.js
│       │                            (Haversine), cart.js, format.js, whatsapp.js, config.js
│       │                            (baca env var), supabaseClient.js, products/promos/orders/
│       │                            settings.js (mutation functions)
│       ├── hooks/                 ← useProducts, usePromos, useOrders, useSettings
│       └── components/            ← Modal, Toast, ConfirmDialog (shell generik)
├── css/
│   ├── main.css                ← Style bersama (warna, font, animasi, modal umum)
│   ├── catalog.css             ← Style halaman katalog, checkout, QRIS, profile sheet
│   ├── admin.css                ← Style dashboard admin
│   └── tracking.css             ← Style halaman lacak pesanan
├── supabase/
│   └── functions/
│       └── check-shipping/      ← Edge Function proxy Biteship (satu-satunya kode "backend")
├── .env.example                 ← Template environment variables (salin ke .env)
├── vite.config.js                ← Vite config, tiga entry (customer + admin + tracking)
└── README.md
```

Tidak ada `js/config.js` lagi — semua konstanta per-toko sekarang jadi environment variables (`.env`), dibaca lewat satu tempat di `src/shared/lib/config.js`.

---

## 6. Alur Pemesanan (Customer)

1. Pilih produk & varian di katalog → masuk keranjang. Produk dengan stok terbatas nampilin sisa stok dan otomatis nge-badge "Habis" begitu kosong (lihat §1 catatan `stock_qty`). Keranjang mengambang di bawah bisa di-tap buat expand, lihat detail item tanpa pindah halaman.
2. Pilih tipe pesanan: **Pickup** (ambil di toko) atau **Delivery**
3. Kalau Delivery: isi profil (nama, WhatsApp) lewat kartu profil yang membuka bottom sheet. Alamat bukan field teks biasa — tap kartu alamat buka **halaman pencarian full-screen** (bukan dropdown kecil di dalam sheet): ketik, pilih hasil dari LocationIQ, lanjut ke layar konfirmasi lokasi (peta lebih besar + catatan alamat opsional), baru "Simpan Alamat Ini" balik ke form profil dengan alamat tersimpan sebagai kartu ringkasan (bisa di-tap lagi buat ganti, atau dihapus). Nama/WhatsApp/alamat/catatan-nya diingat otomatis buat kunjungan berikutnya (disimpan di `localStorage`, bertahan meski browser ditutup) — cuma bagian ini yang persist, keranjang & tanggal pesanan selalu mulai kosong tiap kunjungan.
4. Ongkir dicek otomatis lewat Biteship (pilihan GoSend/GrabExpress dengan harga real-time) — kalau tidak tersedia, fallback ke tarif jarak statis. Untuk Delivery, customer wajib ada hasil ongkir dulu (opsi kepilih otomatis) sebelum bisa lanjut ke pembayaran.
5. Bisa pakai kode promo (persen/nominal, dicek minimum order & masa berlaku)
6. Konfirmasi pesanan → QRIS dinamis digenerate langsung di browser sesuai total akhir, bisa disimpan sebagai gambar (tombol "Simpan QR")
7. Setelah bayar, customer konfirmasi → pesanan tersimpan ke database (stok otomatis berkurang lewat `place_order()`, lihat §1) dengan status `pending`, dan link WhatsApp ke admin terbuka otomatis untuk kirim bukti bayar
8. Di ringkasan pesanan, ada tombol **"Tampilkan QR lagi"** (popup ringan, read-only) kalau customer perlu lihat ulang QR-nya, dan link ke halaman **Lacak Pesanan** (`/tracking/`) buat cek status kapan saja pakai kode pesanan + nomor WhatsApp

QRIS di sini **tidak ada masa kedaluwarsa** — karena digenerate secara deterministik dari QRIS statis + nominal (bukan dari payment gateway), QR yang sama selalu bisa dibuat ulang kapan saja dari nominal yang sama.

---

## 7. Panduan Admin

### Akses Dashboard
Buka: `namawebsite.vercel.app/admin/` → login dengan email + password.

### Tab Produk
Klik **+ Tambah Produk** → isi nama, deskripsi, harga, stok (opsional), upload foto, atur varian (opsional), badge & visibilitas → **Simpan Produk**.

- **Stok** dikosongkan = produk selalu tersedia (default, tidak perlu diisi kalau memang tidak dibatasi). Diisi angka kalau stoknya terbatas — otomatis berkurang tiap ada pesanan masuk, dan begitu habis (0) katalog customer otomatis nampilin badge **"Habis"** (produk tetap kelihatan, cuma tidak bisa dipesan) tanpa perlu admin edit manual.
- Toggle **"Tampilkan di Katalog"** beda kegunaan dari stok — ini buat sembunyiin produk total dari katalog (misal produk yang sudah tidak dijual lagi), bukan buat stok habis sementara.

**⬆ Import CSV** — tambah banyak produk sekaligus dari file CSV (kolom: Nama, Deskripsi, Harga, Stok, Badge New, Badge Terlaris, Tampil di Katalog). Ada tombol **Download Template CSV** buat mulai dari format yang benar. Baris yang nama/harga/stoknya tidak valid otomatis dilewati (bukan bikin seluruh import gagal) dan ditampilkan alasannya sebelum kamu konfirmasi. Foto & varian tidak bisa lewat CSV — tambahkan manual lewat Edit setelah produk ke-import.

### Tab Promo
Klik **+ Tambah Promo** → isi kode, tipe diskon (persen/nominal), minimum order, tanggal berlaku (opsional), status aktif → **Simpan Promo**.

### Tab Pesanan
Daftar pesanan masuk, bisa difilter per status: **Menunggu** (pending) → **Diproses** (confirmed) → **Selesai** (done), atau **Dibatalkan**.
Klik **📋 Detail** pada satu pesanan untuk:
- Lihat rincian lengkap (item, ongkir, diskon, alamat, catatan)
- **✅ Konfirmasi** / **✅ Selesai** / **❌ Batalkan** — ubah status pesanan
- **🖨️ Print Label** — cetak label pengiriman/pickup
- **📤 WA Customer** — kirim ringkasan pesanan (item, total, alamat, status) langsung ke WhatsApp customer, berguna kalau mereka tanya-tanya soal pesanannya

**⬇ Export CSV** — export daftar pesanan yang lagi ke-filter (misal filter "Selesai" dulu baru export, buat laporan omset) ke file `.csv`, siap dibuka di Excel/Google Sheets. Semua diproses di browser, tidak ada server/biaya tambahan.

**🔔 Notifikasi pesanan baru** — begitu ada pesanan masuk, admin yang lagi buka dashboard langsung dapat toast + bunyi + badge angka di tab "Pesanan" (real-time lewat Supabase Realtime, bukan polling). Cuma jalan selagi tab dashboard-nya kebuka di browser — bukan push notification asli ke HP/notifikasi sistem (itu butuh service worker + infrastruktur Web Push, di luar scope "client-side by default" project ini). Butuh Realtime diaktifkan buat tabel `orders` — sudah termasuk di `supabase-setup.sql` §6, atau aktifkan manual dari Supabase Dashboard → **Database** → **Replication**.

### Tab Pengaturan
Ubah nama brand, ikon/logo, alamat & jam operasional toko, link Google Maps, banner katalog (judul, subjudul, foto), dan link Instagram/TikTok — semua tersimpan di tabel `settings` dan langsung berlaku di katalog tanpa perlu edit kode.

### Ganti Nomor WhatsApp Admin
Ubah `VITE_ADMIN_WHATSAPP` di `.env` (dan di env var hosting kalau sudah deploy), lalu redeploy.
Format: `62` + nomor tanpa `0` di depan.
Contoh: `08123456789` → tulis `628123456789`

---

## 8. Troubleshooting

Masalah-masalah yang pernah muncul waktu deploy project ini, dan cara fix-nya:

**"The version of Vite used in the project (X.X.X) cannot be automatically configured. Please update the Vite version to at least 6.0.0"** (saat deploy ke Cloudflare)
Cloudflare butuh Vite ≥6 supaya bisa auto-detect config project. Project ini sudah pakai Vite 8 (`package.json`) — kalau muncul lagi berarti ada downgrade tidak sengaja, jalankan `npm install vite@latest @vitejs/plugin-react@latest` lalu `npm run build` untuk verifikasi.

**"[ERROR] Error parsing file: .../vite.config.js"** (saat deploy ke Cloudflare)
Terjadi kalau Cloudflare project dibuat lewat alur **Workers** (bukan Pages) — Wrangler otomatis coba parse `vite.config.js` untuk deteksi config, dan gagal karena config multi-entry (customer + admin) di project ini tidak dikenali sama plugin Vite-nya Wrangler. Sudah di-fix permanen lewat `wrangler.jsonc` di root repo yang mendeklarasikan deploy sebagai static-assets-only (lihat §4) — Wrangler jadi skip parsing `vite.config.js` sama sekali. Kalau error ini muncul lagi, cek `wrangler.jsonc` masih ada dan isinya masih `assets.directory: "./dist"`.

**"supabaseUrl is required"** (blank page setelah deploy)
Env var `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` belum diisi di platform hosting (Vercel/Netlify/Cloudflare Environment Variables). Ingat: Vite meng-inline semua `VITE_*` ke bundle **saat build**, bukan saat runtime — jadi setelah menambah/mengubah env var, harus **trigger rebuild/redeploy**, restart server saja tidak cukup.

**Logo brand tampil kegedean di header**
Kalau custom logo (`logo_url` dari tab Pengaturan) dipasang tapi CSS class `brand-icon-logo` ketinggalan dari `className` elemen `<img>`-nya, logo cuma kena style default (`object-fit` dsb tidak ke-apply) jadi tampil raw-size. Class ini wajib ada berbarengan dengan class icon-nya (`ob-brand-icon brand-icon-logo` di `OrderTypeStep.jsx`, `topbar-icon brand-icon-logo` di `CatalogStep.jsx`) — kalau nambah tempat baru yang bisa nampilin logo custom, jangan lupa pasang keduanya. Logo teks (`logo_text_url`) punya class sizing sendiri (`ob-brand-name-logo`/`topbar-brand-name-logo`) — jangan ketuker sama class logo ikon.

**Edge Function `check-shipping` gagal dengan `TypeError: Invalid header value: "biteship_test...\neyJ..."`**
Ada newline literal ke-paste di tengah secret `BITESHIP_API_KEY` — lihat catatan lengkap di §3.

**`401 Unauthorized` / `new row violates row-level security policy for table "orders"` saat konfirmasi pesanan**
RLS policy `"Public insert orders"` untuk role `anon` belum ada di database live (drift dari skema kanonik) — lihat catatan lengkap + query diagnostik di §9 bagian Catatan Keamanan di bawah.

---

## 9. Catatan Keamanan

- Supabase URL dan anon key masuk ke bundle JS lewat `VITE_*` env var — ini **normal** untuk static site (Vite meng-inline nilai `VITE_*` ke kode saat build, jadi tetap terlihat di browser walau sumbernya `.env`). Anon key hanya boleh baca data publik.
- Row Level Security (RLS) memastikan:
  - Produk: publik hanya baca yang `is_visible = true`; tambah/edit/hapus hanya admin login.
  - Promo: publik hanya baca kode yang `is_active = true`; kelola penuh hanya admin.
  - Settings: publik boleh baca (untuk tampilan katalog); ubah hanya admin.
  - Orders: publik **hanya bisa membuat** pesanan (insert), **tidak bisa membaca** pesanan siapapun — mencegah kebocoran data pelanggan lain. Baca/ubah status hanya admin login.
- LocationIQ API key di kode frontend juga normal (tier gratis, dipakai untuk autocomplete alamat saja) — kalau mau lebih aman, batasi domain yang boleh pakai key tersebut di dashboard LocationIQ.
- **Biteship API key BEDA** — ini secret dan tidak punya mekanisme pembatasan domain. **Jangan pernah** taruh di `.env` (yang bisa masuk ke bundle frontend). Selalu lewat Edge Function `check-shipping` yang menyimpannya sebagai Supabase secret (server-side only, tidak pernah dikirim ke browser) — kode React tidak punya jalur lain untuk manggil Biteship.
- Jangan pernah taruh **Service Role key** Supabase di kode frontend.
- **Policy RLS live di Supabase bisa "drift" dari SQL kanonik di README ini** — SQL di §1 adalah skema yang *seharusnya* ada, tapi kalau ada perubahan manual lewat dashboard/SQL editor yang tidak balik disinkronkan ke README, project lama bisa berakhir dengan policy yang berbeda dari dokumentasi (misalnya pernah kejadian: tabel `orders` di production cuma punya policy admin, **tanpa** `"Public insert orders"`, sehingga semua percobaan checkout customer gagal dengan error `42501 new row violates row-level security policy`). Kalau curiga ada drift, cek langsung yang live:
  ```sql
  SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'orders';
  ```
  Bandingkan hasilnya dengan `CREATE POLICY` di §1 — kalau ada yang hilang, tinggal jalankan ulang statement yang bersangkutan (aman, tidak menghapus data).
