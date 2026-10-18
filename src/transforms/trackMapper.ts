import { formatCoverUrl } from './coverUrl.js';

export interface AddonTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // In seconds (Double), NOT milliseconds
  artworkURL: string | null;
  format: string;
  audioQuality: string;
  isrc?: string | null;
}

export function mapHiFiTrackToAddon(item: any): AddonTrack {
  const artistName =
    item.artist?.name ||
    (Array.isArray(item.artists) && item.artists[0]?.name) ||
    'Unknown Artist';

  const isHires =
    Array.isArray(item.mediaMetadata?.tags) &&
    item.mediaMetadata.tags.includes('HIRES_LOSSLESS');

  return {
    id: String(item.id),
    title: item.title || '',
    artist: artistName,
    album: item.album?.title || '',
    // Strict requirement REQ-SCH-05: Duration in SECONDS, never milliseconds!
    duration: Number(item.duration || 0),
    artworkURL: formatCoverUrl(item.album?.cover),
    format: 'flac',
    audioQuality: isHires ? 'HI_RES_LOSSLESS' : 'LOSSLESS',
    isrc: item.isrc || null
  };
}
