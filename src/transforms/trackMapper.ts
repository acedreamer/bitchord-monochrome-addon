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
    (Array.isArray(item.artistNames) && item.artistNames.length > 0)
      ? item.artistNames.join(', ')
      : item.artist?.name ||
        (Array.isArray(item.artists) && item.artists[0]?.name) ||
        'Unknown Artist';

  const rawDuration = Number(item.duration || 0);
  // Strict requirement REQ-SCH-05: Duration in SECONDS, never milliseconds!
  // If upstream provides milliseconds (e.g. tracks.monochrome.st: 248457), convert to seconds.
  const durationInSeconds =
    rawDuration > 1000 ? Math.round((rawDuration / 1000) * 100) / 100 : rawDuration;

  const artworkUrl = item.artwork || formatCoverUrl(item.album?.cover);

  const isHires =
    Array.isArray(item.mediaMetadata?.tags) &&
    item.mediaMetadata.tags.includes('HIRES_LOSSLESS');

  return {
    id: String(item.id || item.trackId),
    title: item.title || '',
    artist: artistName,
    album: item.album?.title || item.releaseTitle || '',
    duration: durationInSeconds,
    artworkURL: artworkUrl || null,
    format: 'flac',
    audioQuality: isHires ? 'HI_RES_LOSSLESS' : 'LOSSLESS',
    isrc: item.isrc || null
  };
}
