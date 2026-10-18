import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCoverUrl } from '../src/transforms/coverUrl.js';
import { mapHiFiTrackToAddon } from '../src/transforms/trackMapper.js';

describe('Transform Utilities', () => {
  describe('formatCoverUrl (REQ-SCH-06)', () => {
    it('correctly transforms UUID with hyphens to Tidal CDN URL', () => {
      const uuid = '4e73f2aa-a392-4217-9150-14e4b4764834';
      const expected =
        'https://resources.tidal.com/images/4e73f2aa/a392/4217/9150/14e4b4764834/640x640.jpg';
      assert.strictEqual(formatCoverUrl(uuid), expected);
    });

    it('returns null for null, undefined, or empty cover UUID', () => {
      assert.strictEqual(formatCoverUrl(null), null);
      assert.strictEqual(formatCoverUrl(undefined), null);
      assert.strictEqual(formatCoverUrl(''), null);
      assert.strictEqual(formatCoverUrl('   '), null);
    });
  });

  describe('mapHiFiTrackToAddon (REQ-SCH-04, REQ-SCH-05, REQ-SCH-07)', () => {
    it('enforces duration in SECONDS and never milliseconds (REQ-SCH-05)', () => {
      const upstreamItem = {
        id: 142283478,
        title: 'Yellow',
        artist: { name: 'Coldplay' },
        album: {
          title: 'Parachutes',
          cover: '4e73f2aa-a392-4217-9150-14e4b4764834'
        },
        duration: 266, // 266 seconds
        isrc: 'GBAYE0000038',
        mediaMetadata: {
          tags: ['LOSSLESS']
        }
      };

      const mapped = mapHiFiTrackToAddon(upstreamItem);

      assert.strictEqual(mapped.id, '142283478');
      assert.strictEqual(mapped.title, 'Yellow');
      assert.strictEqual(mapped.artist, 'Coldplay');
      assert.strictEqual(mapped.album, 'Parachutes');
      // Crucial: 266.0, not 266000
      assert.strictEqual(mapped.duration, 266);
      assert.strictEqual(
        mapped.artworkURL,
        'https://resources.tidal.com/images/4e73f2aa/a392/4217/9150/14e4b4764834/640x640.jpg'
      );
      assert.strictEqual(mapped.format, 'flac');
      assert.strictEqual(mapped.audioQuality, 'LOSSLESS');
      assert.strictEqual(mapped.isrc, 'GBAYE0000038');
    });

    it('identifies HI_RES_LOSSLESS quality tag and handles artists array', () => {
      const upstreamItem = {
        id: 999999,
        title: 'Hi-Res Track',
        artists: [{ name: 'Primary Artist' }, { name: 'Featured Artist' }],
        duration: 180.5,
        mediaMetadata: {
          tags: ['HIRES_LOSSLESS', 'LOSSLESS']
        }
      };

      const mapped = mapHiFiTrackToAddon(upstreamItem);

      assert.strictEqual(mapped.artist, 'Primary Artist');
      assert.strictEqual(mapped.audioQuality, 'HI_RES_LOSSLESS');
      assert.strictEqual(mapped.duration, 180.5);
      assert.strictEqual(mapped.artworkURL, null);
    });

    it('falls back to Unknown Artist and empty album if omitted', () => {
      const item = {
        id: 1234,
        title: 'Minimal Item'
      };

      const mapped = mapHiFiTrackToAddon(item);
      assert.strictEqual(mapped.artist, 'Unknown Artist');
      assert.strictEqual(mapped.album, '');
      assert.strictEqual(mapped.duration, 0);
      assert.strictEqual(mapped.isrc, null);
    });
  });
});
