-- ================================================================
-- SETUP LENGKAP
-- Jalankan SEKALI di Supabase SQL Editor
-- ================================================================


-- ----------------------------------------------------------------
-- 1. EXTENSION (sudah aktif di Supabase, ini untuk jaga-jaga)
-- ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ----------------------------------------------------------------
-- 2. TABEL PRODUCTS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
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

-- Safe to re-run on an existing install that predates stock_qty.
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_qty INTEGER;
COMMENT ON COLUMN products.stock_qty IS 'NULL = stok tidak dilacak (selalu tersedia). Angka = stok dikurangi otomatis oleh place_order() tiap ada order.';

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Pengunjung hanya bisa baca produk yang tampil (is_visible = true)
DROP POLICY IF EXISTS "Public read visible products" ON products;
CREATE POLICY "Public read visible products"
  ON products FOR SELECT TO anon
  USING (is_visible = true);

-- Admin bisa baca SEMUA produk (termasuk yang disembunyikan)
DROP POLICY IF EXISTS "Admin read all products" ON products;
CREATE POLICY "Admin read all products"
  ON products FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin insert products" ON products;
CREATE POLICY "Admin insert products"
  ON products FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin update products" ON products;
CREATE POLICY "Admin update products"
  ON products FOR UPDATE TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin delete products" ON products;
CREATE POLICY "Admin delete products"
  ON products FOR DELETE TO authenticated
  USING (true);


-- ----------------------------------------------------------------
-- 3. TABEL PROMO_CODES
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promo_codes (
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
DROP POLICY IF EXISTS "Public read active promo" ON promo_codes;
CREATE POLICY "Public read active promo"
  ON promo_codes FOR SELECT TO anon
  USING (is_active = true);

DROP POLICY IF EXISTS "Admin full access promo" ON promo_codes;
CREATE POLICY "Admin full access promo"
  ON promo_codes FOR ALL TO authenticated
  USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------
-- 4. TABEL SETTINGS (single row, id selalu 1)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
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

ALTER TABLE settings ADD COLUMN IF NOT EXISTS logo_text_url TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS favicon_url TEXT;

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read settings" ON settings;
CREATE POLICY "Public read settings"
  ON settings FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "Admin full access settings" ON settings;
CREATE POLICY "Admin full access settings"
  ON settings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Seed row id=1 wajib ada dari awal — kalau kosong, query `.single()` di
-- useSettings() balik 406 (bukan RLS, tapi PostgREST nganggep "0 rows" invalid
-- buat query yang expect exactly 1 row).
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;


-- ----------------------------------------------------------------
-- 5. TABEL ORDERS
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
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

-- WAJIB ada — ini yang paling sering ke-skip kalau setup manual, dan bikin
-- checkout customer gagal 42501 "row violates row-level security policy".
DROP POLICY IF EXISTS "Public insert orders" ON orders;
CREATE POLICY "Public insert orders"
  ON orders FOR INSERT TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin full access orders" ON orders;
CREATE POLICY "Admin full access orders"
  ON orders FOR ALL TO authenticated
  USING (true) WITH CHECK (true);


-- ----------------------------------------------------------------
-- 6. REALTIME — buat notifikasi "pesanan baru" live di dashboard admin
-- ----------------------------------------------------------------
-- Tanpa ini, dashboard admin tetap jalan normal (cuma harus refresh manual
-- buat lihat pesanan baru) — tidak wajib untuk fitur checkout/pesanan bekerja,
-- cuma dibutuhkan kalau mau notifikasi live (lihat useNewOrderAlerts.js).
-- Realtime tetap tunduk ke RLS: anon tidak dikasih SELECT di tabel ini
-- (lihat §5), jadi customer tidak ikut kebagian event ini — hanya admin yang
-- login (authenticated, kena policy "Admin full access orders" di atas).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  END IF;
END $$;


-- ----------------------------------------------------------------
-- 7. FUNCTION place_order() — insert order + kurangi stok, atomic
-- ----------------------------------------------------------------
-- Dipanggil dari browser lewat supabase.rpc('place_order', ...) sebagai
-- pengganti insert langsung ke `orders`. Alasannya WAJIB backend (bukan
-- sekadar preferensi): cek-lalu-kurangi stok dari JS punya race condition
-- kalau 2 customer checkout produk yang sama nyaris bersamaan — dua-duanya
-- bisa lolos cek stok sebelum salah satu sempat nulis hasil kurangnya.
-- Function ini jalan sebagai satu transaksi Postgres: tiap item di
-- stock_items dikurangi dari products.stock_qty HANYA kalau stok cukup;
-- begitu ada satu item yang gagal, seluruh transaksi (termasuk kurang
-- stok yang sudah sempat jalan di item sebelumnya) di-rollback dan order
-- TIDAK jadi ke-insert. Produk dengan stock_qty NULL dianggap tak terbatas,
-- tidak pernah dikurangi/gagal.
--
-- SECURITY DEFINER supaya bisa UPDATE products.stock_qty walau anon tidak
-- (dan sengaja tidak diberi) policy UPDATE langsung ke tabel products —
-- akses ke situ hanya lewat function sempit ini, bukan policy terbuka.
CREATE OR REPLACE FUNCTION place_order(order_data JSONB, stock_items JSONB)
RETURNS SETOF orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item JSONB;
  affected INTEGER;
  prod_name TEXT;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(stock_items)
  LOOP
    UPDATE products
    SET stock_qty = stock_qty - (item->>'qty')::INTEGER
    WHERE id = (item->>'product_id')::UUID
      AND (stock_qty IS NULL OR stock_qty >= (item->>'qty')::INTEGER);

    GET DIAGNOSTICS affected = ROW_COUNT;

    IF affected = 0 THEN
      SELECT name INTO prod_name FROM products WHERE id = (item->>'product_id')::UUID;
      RAISE EXCEPTION 'STOK_HABIS: % stoknya tidak cukup', COALESCE(prod_name, 'Produk ini');
    END IF;
  END LOOP;

  RETURN QUERY
  INSERT INTO orders (
    order_number, customer_name, customer_wa, order_type, order_date, order_date_label,
    delivery_address, note, items, subtotal, promo_code, discount_amount,
    shipping_cost, shipping_label, total, qris_string, status
  )
  SELECT
    order_data->>'order_number', order_data->>'customer_name', order_data->>'customer_wa',
    order_data->>'order_type', (order_data->>'order_date')::DATE, order_data->>'order_date_label',
    order_data->>'delivery_address', order_data->>'note', order_data->'items',
    (order_data->>'subtotal')::INTEGER, order_data->>'promo_code', (order_data->>'discount_amount')::INTEGER,
    (order_data->>'shipping_cost')::INTEGER, order_data->>'shipping_label', (order_data->>'total')::INTEGER,
    order_data->>'qris_string', COALESCE(order_data->>'status', 'pending')
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION place_order(JSONB, JSONB) TO anon;


-- ----------------------------------------------------------------
-- 8. FUNCTION lookup_order() — cek status pesanan tanpa login
-- ----------------------------------------------------------------
-- Dipakai halaman /tracking/ (lihat src/tracking/). `orders` RLS sengaja
-- insert-only untuk anon (lihat CLAUDE.md "Kenapa begini") — customer tidak
-- pernah dikasih SELECT langsung ke tabel ini, karena policy SELECT terbuka
-- bakal bisa di-scan buat ngintip data pesanan customer lain. Function ini
-- jalan lewat rpc(), bukan lewat query builder biasa: hanya balikin 1 baris
-- kalau order_number DAN customer_wa-nya cocok berbarengan (order_number
-- itu sendiri sudah acak/susah ditebak — 5 karakter base36 setelah prefix —
-- jadi kombinasi keduanya cukup aman buat skala UMKM tanpa perlu akun/OTP).
CREATE OR REPLACE FUNCTION lookup_order(p_order_number TEXT, p_customer_wa TEXT)
RETURNS SETOF orders
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM orders
  WHERE order_number = p_order_number
    AND customer_wa = p_customer_wa;
$$;

GRANT EXECUTE ON FUNCTION lookup_order(TEXT, TEXT) TO anon;


-- ----------------------------------------------------------------
-- 9. STORAGE BUCKET (foto produk, logo, banner)
-- ----------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Siapapun bisa lihat foto (public)
DROP POLICY IF EXISTS "Public read images" ON storage.objects;
CREATE POLICY "Public read images"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'product-images');

-- Hanya admin yang bisa upload foto
DROP POLICY IF EXISTS "Admin upload images" ON storage.objects;
CREATE POLICY "Admin upload images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images');

-- Hanya admin yang bisa hapus foto
DROP POLICY IF EXISTS "Admin delete images" ON storage.objects;
CREATE POLICY "Admin delete images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images');

-- Hanya admin yang bisa update file — WAJIB ada juga, walau kelihatan tidak
-- kepakai: upload dengan { upsert: true } (dipakai SettingsTab untuk logo/
-- banner) dijalankan Storage API sebagai INSERT ... ON CONFLICT DO UPDATE,
-- dan Postgres butuh privilege UPDATE (lolos RLS UPDATE) untuk cabang itu
-- SAAT PLANNING — walau ujungnya tidak ada baris yang bentrok. Tanpa policy
-- ini, upload dengan upsert:true gagal 400 "new row violates row-level
-- security policy" meskipun policy INSERT-nya sendiri sudah benar.
DROP POLICY IF EXISTS "Admin update images" ON storage.objects;
CREATE POLICY "Admin update images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images');


-- ----------------------------------------------------------------
-- 10. BUAT AKUN ADMIN
--    Email    : admin@youremail.com
--    Password : admin123   ← ganti setelah pertama login!
-- ----------------------------------------------------------------
DO $$
DECLARE
  v_uid UUID := gen_random_uuid();
BEGIN
  -- Hanya buat kalau email belum ada
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@youremail.com') THEN

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated',
      'authenticated',
      'admin@youremail.com',
      crypt('admin123', gen_salt('bf')),
      now(),                                               -- langsung confirmed, tidak perlu verifikasi email
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(),
      now(),
      '', '', '', ''
    );

    -- Identity record diperlukan agar login email/password bisa bekerja
    INSERT INTO auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      v_uid,
      v_uid,
      'admin@youremail.com',
      jsonb_build_object(
        'sub',            v_uid::text,
        'email',          'admin@youremail.com',
        'email_verified', true,
        'provider',       'email'
      ),
      'email',
      now(),
      now(),
      now()
    );

    RAISE NOTICE 'Akun admin berhasil dibuat: admin@youremail.com';
  ELSE
    RAISE NOTICE 'Akun admin sudah ada, dilewati.';
  END IF;
END $$;


-- ----------------------------------------------------------------
-- 11. VERIFIKASI — cek hasil setup
-- ----------------------------------------------------------------
SELECT 'products table'   AS item, COUNT(*)::text AS info FROM products
UNION ALL
SELECT 'promo_codes table', COUNT(*)::text FROM promo_codes
UNION ALL
SELECT 'settings row',     COALESCE((SELECT 'id=1 ada' FROM settings WHERE id = 1), 'TIDAK ADA')
UNION ALL
SELECT 'orders table',     COUNT(*)::text FROM orders
UNION ALL
SELECT 'orders realtime',  COALESCE((SELECT 'aktif' FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'orders'), 'TIDAK AKTIF')
UNION ALL
SELECT 'place_order function', COALESCE((SELECT 'ada' FROM pg_proc WHERE proname = 'place_order'), 'TIDAK ADA')
UNION ALL
SELECT 'lookup_order function', COALESCE((SELECT 'ada' FROM pg_proc WHERE proname = 'lookup_order'), 'TIDAK ADA')
UNION ALL
SELECT 'storage bucket',   COALESCE((SELECT name FROM storage.buckets WHERE id = 'product-images'), 'TIDAK ADA')
UNION ALL
SELECT 'admin user',       COALESCE((SELECT email FROM auth.users WHERE email = 'admin@youremail.com'), 'TIDAK ADA')
UNION ALL
SELECT 'daily_visits table', COALESCE((SELECT 'ada' FROM pg_tables WHERE tablename = 'daily_visits'), 'TIDAK ADA')
UNION ALL
SELECT 'track_visit function', COALESCE((SELECT 'ada' FROM pg_proc WHERE proname = 'track_visit'), 'TIDAK ADA');


-- ----------------------------------------------------------------
-- 12. TABEL DAILY_VISITS + FUNCTION track_visit() — hitung pengunjung
--     halaman katalog customer per hari
-- ----------------------------------------------------------------
-- Satu baris per tanggal (bukan satu baris per visit) supaya tabelnya gak
-- tumbuh gak terbatas — dihitung lewat UPSERT counter, bukan INSERT log.
CREATE TABLE IF NOT EXISTS daily_visits (
  visit_date DATE    PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE daily_visits ENABLE ROW LEVEL SECURITY;

-- Cuma admin yang boleh baca angkanya — anon nulis lewat track_visit() di
-- bawah (SECURITY DEFINER), gak pernah dikasih SELECT/INSERT/UPDATE langsung
-- ke tabel ini, sama pola-nya kayak place_order()/products.stock_qty.
DROP POLICY IF EXISTS "Admin read daily visits" ON daily_visits;
CREATE POLICY "Admin read daily visits"
  ON daily_visits FOR SELECT TO authenticated
  USING (true);

-- Dipanggil dari src/customer/App.jsx sekali tiap kunjungan (lihat
-- shared/lib/visits.js). UPSERT + count = count + 1 atomic di satu statement
-- supaya dua kunjungan bersamaan gak saling timpa (race condition sama kayak
-- alasan place_order() jadi function, bukan sekadar preferensi).
CREATE OR REPLACE FUNCTION track_visit()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO daily_visits (visit_date, count)
  VALUES (CURRENT_DATE, 1)
  ON CONFLICT (visit_date) DO UPDATE SET count = daily_visits.count + 1;
$$;

GRANT EXECUTE ON FUNCTION track_visit() TO anon;
