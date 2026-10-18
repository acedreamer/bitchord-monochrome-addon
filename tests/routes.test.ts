import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index.js';
import { InstancePool } from '../src/pool/instancePool.js';

describe('HTTP Route Integration Tests (Phase 6.3)', () => {
  let app: FastifyInstance;
  let pool: InstancePool;
  const originalFetch = globalThis.fetch;

  before(async () => {
    process.env.NODE_ENV = 'test';
    pool = new InstancePool();
    pool.setInstances(['https://mock-node.example.com']);
    app = await buildApp(pool);
  });

  after(async () => {
    await app.close();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    pool.clearBlacklist();
  });

  describe('GET /manifest.json (REQ-MAN-01, REQ-MAN-02, REQ-MAN-03, REQ-MAN-04, REQ-OPS-02)', () => {
    it('returns valid BitChord manifest with exact required schema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/manifest.json',
        headers: {
          Origin: 'http://localhost:3000'
        }
      });

      assert.strictEqual(res.statusCode, 200);
      assert.match(res.headers['content-type'] || '', /application\/json/);
      assert.strictEqual(
        res.headers['access-control-allow-origin'],
        'http://localhost:3000'
      );

      const body = JSON.parse(res.payload);
      assert.strictEqual(body.id, 'com.bitchord.addon.monochrome');
      assert.strictEqual(body.name, 'Monochrome Lossless Provider');
      assert.strictEqual(body.version, '1.0.0');
      assert.strictEqual(body.contentType, 'music');
      assert.deepStrictEqual(body.types, ['track']);

      // REQ-MAN-03: Strictly ["search", "stream", "settings"], no "isrc" or "resolve"
      assert.deepStrictEqual(body.resources, ['search', 'stream', 'settings']);

      // REQ-MAN-04: audio_quality setting
      assert.ok(Array.isArray(body.settings));
      const qualitySetting = body.settings.find((s: any) => s.key === 'audio_quality');
      assert.ok(qualitySetting);
      assert.strictEqual(qualitySetting.default, 'LOSSLESS');
      const optionValues = qualitySetting.options.map((o: any) => o.value);
      assert.deepStrictEqual(optionValues, ['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH']);
    });
  });

  describe('GET /search (REQ-SCH-01, REQ-SCH-02, REQ-SCH-04, REQ-SCH-05, REQ-SCH-08)', () => {
    it('returns HTTP 400 when query parameter "q" is absent or empty (REQ-SCH-02)', async () => {
      const res1 = await app.inject({ method: 'GET', url: '/search' });
      assert.strictEqual(res1.statusCode, 400);
      assert.deepStrictEqual(JSON.parse(res1.payload), {
        error: 'Query parameter "q" is required.'
      });

      const res2 = await app.inject({ method: 'GET', url: '/search?q=%20%20' });
      assert.strictEqual(res2.statusCode, 400);
      assert.deepStrictEqual(JSON.parse(res2.payload), {
        error: 'Query parameter "q" is required.'
      });
    });

    it('returns mapped tracks with duration in seconds (REQ-SCH-04, REQ-SCH-05)', async () => {
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/search/?s=Yellow')) {
          return new Response(
            JSON.stringify({
              data: {
                items: [
                  {
                    id: 142283478,
                    title: 'Yellow',
                    artist: { name: 'Coldplay' },
                    album: {
                      title: 'Parachutes',
                      cover: '4e73f2aa-a392-4217-9150-14e4b4764834'
                    },
                    duration: 266, // seconds
                    isrc: 'GBAYE0000038',
                    mediaMetadata: { tags: ['LOSSLESS'] }
                  }
                ]
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(null, { status: 404 });
      };

      const res = await app.inject({
        method: 'GET',
        url: '/search?q=Yellow'
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.ok(Array.isArray(body.tracks));
      assert.strictEqual(body.tracks.length, 1);

      const track = body.tracks[0];
      assert.strictEqual(track.id, '142283478');
      assert.strictEqual(track.title, 'Yellow');
      assert.strictEqual(track.artist, 'Coldplay');
      assert.strictEqual(track.duration, 266); // Seconds
      assert.strictEqual(track.format, 'flac');
      assert.strictEqual(track.isrc, 'GBAYE0000038');
      assert.strictEqual(
        track.artworkURL,
        'https://resources.tidal.com/images/4e73f2aa/a392/4217/9150/14e4b4764834/640x640.jpg'
      );
    });

    it('returns HTTP 502 when all upstream instances fail (REQ-SCH-08)', async () => {
      globalThis.fetch = async () => {
        return new Response('Gateway timeout', { status: 504 });
      };

      const res = await app.inject({
        method: 'GET',
        url: '/search?q=Yellow'
      });

      assert.strictEqual(res.statusCode, 502);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.error, 'Upstream search failed');
    });
  });

  describe('GET /stream/:id (REQ-STR-01, REQ-STR-05, REQ-STR-06, REQ-STR-07, REQ-STR-08)', () => {
    it('returns direct FLAC stream payload for BTS manifest (REQ-STR-05, REQ-STR-07)', async () => {
      const sampleBts = JSON.stringify({
        urls: ['https://swift-tld.tidal.com/sample.flac'],
        sampleRate: 44100,
        bitDepth: 16
      });
      const base64Manifest = Buffer.from(sampleBts).toString('base64');

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/track/?id=123')) {
          return new Response(
            JSON.stringify({
              data: {
                manifest: base64Manifest,
                manifestMimeType: 'application/vnd.tidal.bts',
                assetPresentation: 'FULL'
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(null, { status: 404 });
      };

      const res = await app.inject({
        method: 'GET',
        url: '/stream/123'
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.url, 'https://swift-tld.tidal.com/sample.flac');
      assert.strictEqual(body.format, 'flac');
      assert.strictEqual(body.mimeType, 'audio/flac');
      assert.strictEqual(body.manifest, 'none');
      assert.strictEqual(body.encrypted, false);
      assert.strictEqual(body.sampleRate, 44100);
      assert.strictEqual(body.bitDepth, 16);
    });

    it('automatically steps down from MPEG-DASH to LOSSLESS FLAC (REQ-STR-06)', async () => {
      const dashXml = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period></Period></MPD>`;
      const dashBase64 = Buffer.from(dashXml).toString('base64');

      const fallbackBts = JSON.stringify({
        urls: ['https://swift-tld.tidal.com/stepped_down.flac'],
        sampleRate: 44100,
        bitDepth: 16
      });
      const fallbackBtsBase64 = Buffer.from(fallbackBts).toString('base64');

      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('quality=HI_RES_LOSSLESS')) {
          // Upstream returns DASH for Hi-Res
          return new Response(
            JSON.stringify({
              data: {
                manifest: dashBase64,
                manifestMimeType: 'application/dash+xml',
                assetPresentation: 'FULL'
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('quality=LOSSLESS')) {
          // Automatic step-down query returns direct BTS FLAC
          return new Response(
            JSON.stringify({
              data: {
                manifest: fallbackBtsBase64,
                manifestMimeType: 'application/vnd.tidal.bts',
                assetPresentation: 'FULL'
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(null, { status: 404 });
      };

      const res = await app.inject({
        method: 'GET',
        url: '/stream/456?quality=HI_RES_LOSSLESS'
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.url, 'https://swift-tld.tidal.com/stepped_down.flac');
      assert.strictEqual(body.format, 'flac');
      assert.strictEqual(body.encrypted, false);
      assert.strictEqual(body.sampleRate, 44100);
    });

    it('returns HTTP 502 when stream resolution fails (REQ-STR-08)', async () => {
      globalThis.fetch = async () => {
        return new Response('Not found', { status: 404 });
      };

      const res = await app.inject({
        method: 'GET',
        url: '/stream/999'
      });

      assert.strictEqual(res.statusCode, 502);
      const body = JSON.parse(res.payload);
      assert.strictEqual(body.error, 'Stream extraction failed');
    });
  });
});
