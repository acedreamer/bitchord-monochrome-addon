import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeStreamManifest } from '../src/transforms/manifestDecoder.js';

describe('Manifest Decoder (REQ-STR-04, REQ-STR-05, REQ-STR-06, REQ-STR-07)', () => {
  it('correctly decodes BTS JSON manifest to direct FLAC stream payload', () => {
    const rawBtsJson = JSON.stringify({
      mimeType: 'audio/flac',
      codecs: 'flac',
      encryptionType: 'NONE',
      urls: ['https://swift-tld.tidal.com/audio/sample_stream.flac?token=123'],
      sampleRate: 44100,
      bitDepth: 16
    });
    const base64Manifest = Buffer.from(rawBtsJson).toString('base64');

    const result = decodeStreamManifest(
      base64Manifest,
      'application/vnd.tidal.bts',
      'LOSSLESS'
    );

    assert.strictEqual(result.isDash, false);
    assert.ok(result.stream);
    assert.strictEqual(
      result.stream.url,
      'https://swift-tld.tidal.com/audio/sample_stream.flac?token=123'
    );
    assert.strictEqual(result.stream.format, 'flac');
    assert.strictEqual(result.stream.quality, 'LOSSLESS');
    assert.strictEqual(result.stream.mimeType, 'audio/flac');
    assert.strictEqual(result.stream.manifest, 'none');
    // REQ-STR-07: Explicitly emitted encrypted: false
    assert.strictEqual(result.stream.encrypted, false);
    assert.strictEqual(result.stream.sampleRate, 44100);
    assert.strictEqual(result.stream.bitDepth, 16);
    assert.ok(result.stream.headers['User-Agent']);
  });

  it('detects MPEG-DASH XML manifest and flags isDash: true (REQ-STR-06)', () => {
    const rawDashXml = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" minBufferTime="PT1.5S">
  <Period>
    <AdaptationSet mimeType="audio/mp4" codecs="flac">
      <Representation id="1" bandwidth="1500000" sampleRate="96000" />
    </AdaptationSet>
  </Period>
</MPD>`;
    const base64Manifest = Buffer.from(rawDashXml).toString('base64');

    const result = decodeStreamManifest(
      base64Manifest,
      'application/dash+xml',
      'HI_RES_LOSSLESS'
    );

    assert.strictEqual(result.isDash, true);
    assert.strictEqual(result.stream, undefined);
  });

  it('detects DASH XML even when mimeType is generic if content starts with <MPD', () => {
    const rawDashXml = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period></Period></MPD>`;
    const base64Manifest = Buffer.from(rawDashXml).toString('base64');

    const result = decodeStreamManifest(base64Manifest, '', 'HI_RES_LOSSLESS');
    assert.strictEqual(result.isDash, true);
  });

  it('rejects BTS manifest if URL is non-HTTP/HTTPS (REQ-STR-07)', () => {
    const rawBtsJson = JSON.stringify({
      urls: ['data:audio/flac;base64,AAAA']
    });
    const base64Manifest = Buffer.from(rawBtsJson).toString('base64');

    assert.throws(
      () => decodeStreamManifest(base64Manifest, 'application/vnd.tidal.bts'),
      /Stream URL must be HTTP or HTTPS/
    );
  });

  it('throws for empty or malformed base64 input', () => {
    assert.throws(() => decodeStreamManifest(''), /Missing or invalid rawManifestBase64/);
  });
});
