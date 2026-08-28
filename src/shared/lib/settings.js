import { supabase } from './supabaseClient.js';

async function uploadSettingsImage(file, prefix) {
  const ext = file.name.split('.').pop().toLowerCase();
  const fileName = `${prefix}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('product-images')
    .upload(fileName, file, { upsert: true });
  if (uploadError) throw uploadError;
  const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(fileName);
  return urlData.publicUrl;
}

export async function saveSettings({
  brandName, brandIcon, adminWhatsapp, storeAddress, storeHours, storeMapsUrl,
  bannerTitle, bannerSubtitle, instagramUrl, tiktokUrl,
  logoFile, logoTextFile, bannerImageFile, faviconFile,
  existingLogoUrl, existingLogoTextUrl, existingBannerImageUrl, existingFaviconUrl,
}) {
  let logoUrl = existingLogoUrl || null;
  if (logoFile) logoUrl = await uploadSettingsImage(logoFile, 'logo');

  let logoTextUrl = existingLogoTextUrl || null;
  if (logoTextFile) logoTextUrl = await uploadSettingsImage(logoTextFile, 'logo-text');

  let bannerImageUrl = existingBannerImageUrl || null;
  if (bannerImageFile) bannerImageUrl = await uploadSettingsImage(bannerImageFile, 'banner');

  let faviconUrl = existingFaviconUrl || null;
  if (faviconFile) faviconUrl = await uploadSettingsImage(faviconFile, 'favicon');

  const { error } = await supabase.from('settings').upsert({
    id: 1,
    brand_name: brandName,
    brand_icon: brandIcon || '☕',
    logo_url: logoUrl,
    logo_text_url: logoTextUrl,
    favicon_url: faviconUrl,
    admin_whatsapp: adminWhatsapp || null,
    store_address: storeAddress,
    store_hours: storeHours,
    store_maps_url: storeMapsUrl || null,
    banner_title: bannerTitle,
    banner_subtitle: bannerSubtitle,
    banner_image_url: bannerImageUrl,
    instagram_url: instagramUrl || null,
    tiktok_url: tiktokUrl || null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  return { logoUrl, logoTextUrl, bannerImageUrl, faviconUrl };
}
