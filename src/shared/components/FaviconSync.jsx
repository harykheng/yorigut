import { useEffect } from 'react';
import { useSettings } from '../hooks/useSettings.js';

// Swaps the static favicon <link> tags (set in each app's index.html) for the
// admin-uploaded one, if any. Mount once per app (customer/admin/tracking) —
// no-ops and leaves the static favicon in place when settings.favicon_url
// isn't set (table missing, or admin never uploaded one).
export default function FaviconSync() {
  const { settings } = useSettings();

  useEffect(() => {
    const url = settings?.favicon_url;
    if (!url) return;

    document.querySelectorAll('link[rel~="icon"]').forEach((el) => el.remove());
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = url;
    document.head.appendChild(link);
  }, [settings]);

  return null;
}
