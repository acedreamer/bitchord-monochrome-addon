import { UPSTREAM_HEADERS } from '../config.js';

export interface DecodedStreamPayload {
  url: string;
  format: string;
  quality: string;
  mimeType: string;
  manifest: string;
  encrypted: boolean;
  sampleRate: number;
  bitDepth: number;
  headers: Record<string, string>;
}

export interface ManifestDecodeResult {
  isDash: boolean;
  stream?: DecodedStreamPayload;
}

export function decodeStreamManifest(
  rawManifestBase64: string,
  manifestMimeType: string = '',
  quality?: string
): ManifestDecodeResult {
  if (!rawManifestBase64 || typeof rawManifestBase64 !== 'string') {
    throw new Error('Missing or invalid rawManifestBase64 string');
  }

  const decoded = Buffer.from(rawManifestBase64, 'base64').toString('utf-8');
  const trimmed = decoded.trim();

  // 1. MPEG-DASH XML Manifest Detection
  if (
    manifestMimeType.includes('dash+xml') ||
    trimmed.startsWith('<MPD') ||
    trimmed.startsWith('<?xml')
  ) {
    return { isDash: true };
  }

  // 2. Direct FLAC BTS Manifest (application/vnd.tidal.bts or JSON payload)
  if (manifestMimeType.includes('vnd.tidal.bts') || trimmed.startsWith('{')) {
    let manifestJson: any;
    try {
      manifestJson = JSON.parse(trimmed);
    } catch (err: any) {
      throw new Error(`Failed to parse BTS manifest JSON: ${err.message}`);
    }

    const streamUrl = Array.isArray(manifestJson.urls) ? manifestJson.urls[0] : null;

    if (!streamUrl || typeof streamUrl !== 'string') {
      throw new Error('BTS manifest contains no valid stream URL');
    }

    if (!streamUrl.startsWith('http://') && !streamUrl.startsWith('https://')) {
      throw new Error(`Stream URL must be HTTP or HTTPS: ${streamUrl}`);
    }

    return {
      isDash: false,
      stream: {
        url: streamUrl,
        format: 'flac',
        quality: quality || 'LOSSLESS',
        mimeType: 'audio/flac',
        manifest: 'none',
        // BitChord explicitly checks encrypted === false to ensure DRM-free playback
        encrypted: false,
        sampleRate: Number(manifestJson.sampleRate) || 44100,
        bitDepth: Number(manifestJson.bitDepth) || 16,
        headers: {
          'User-Agent': UPSTREAM_HEADERS['User-Agent']
        }
      }
    };
  }

  throw new Error(`Unsupported manifest MIME type or content: ${manifestMimeType}`);
}
