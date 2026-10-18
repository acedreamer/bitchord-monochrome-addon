export const PORT = parseInt(process.env.PORT || '8080', 10);
export const HOST = process.env.HOST || '0.0.0.0';

export const DEFAULT_INSTANCES = [
  'https://wolf.qqdl.site',
  'https://maus.qqdl.site',
  'https://vogel.qqdl.site',
  'https://hund.qqdl.site',
  'https://katze.qqdl.site',
  'https://tidal.kinoplus.online'
];

export const UPSTREAM_TIMEOUT_MS = 5000;
export const BLACKLIST_PREVIEW_COOLDOWN_MS = 300000; // 5 minutes (300,000ms)
export const BLACKLIST_ERROR_COOLDOWN_MS = 180000;   // 3 minutes (180,000ms)

export const DISCOVERY_REGISTRY_URL =
  'https://raw.githubusercontent.com/monochrome-music/monochrome/main/public/instances.json';

export const UPSTREAM_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'x-client': 'BiniLossless/v3.4',
  'Origin': 'https://monochrome.st',
  'Referer': 'https://monochrome.st/'
};
