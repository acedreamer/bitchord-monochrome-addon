import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFromPool, ResponseValidator } from '../src/pool/fetchFromPool.js';
import { InstancePool } from '../src/pool/instancePool.js';
import { UPSTREAM_HEADERS } from '../src/config.js';

describe('fetchFromPool (REQ-POL-05, REQ-POL-06, REQ-POL-07, REQ-STR-03)', () => {
  const originalFetch = globalThis.fetch;
  let pool: InstancePool;

  beforeEach(() => {
    pool = new InstancePool();
    pool.setInstances([
      'https://node-1.example.com',
      'https://node-2.example.com',
      'https://node-3.example.com'
    ]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('performs in-loop failover when validator detects HTTP 200 PREVIEW (REQ-STR-03)', async () => {
    const streamValidator: ResponseValidator = (json) => {
      const trackData = json?.data || json;
      if (trackData.assetPresentation === 'PREVIEW') {
        return { valid: false, reason: 'Preview clip detected', isPreview: true };
      }
      return { valid: true };
    };

    // Node 1 returns HTTP 200 PREVIEW; Node 2 returns HTTP 200 FULL
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://node-1.example.com')) {
        return new Response(
          JSON.stringify({
            data: { assetPresentation: 'PREVIEW', manifest: 'fake_manifest_preview' }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.startsWith('https://node-2.example.com')) {
        return new Response(
          JSON.stringify({
            data: { assetPresentation: 'FULL', manifest: 'fake_manifest_full' }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(null, { status: 500 });
    };

    const result = await fetchFromPool(
      pool,
      '/track/?id=123',
      {},
      streamValidator
    );

    // Node 2 should be returned
    assert.strictEqual(result.instance, 'https://node-2.example.com');
    assert.strictEqual(result.data.data.assetPresentation, 'FULL');

    // Node 1 should be blacklisted
    assert.strictEqual(pool.isBlacklisted('https://node-1.example.com'), true);
  });

  it('fails over to next candidate when candidate returns HTTP 500', async () => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://node-1.example.com')) {
        return new Response('Internal Server Error', { status: 500 });
      }
      if (url.startsWith('https://node-2.example.com')) {
        return new Response(JSON.stringify({ success: true, from: 'node-2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(null, { status: 500 });
    };

    const result = await fetchFromPool(pool, '/test');
    assert.strictEqual(result.instance, 'https://node-2.example.com');
    assert.strictEqual(result.data.success, true);
    assert.strictEqual(pool.isBlacklisted('https://node-1.example.com'), true);
  });

  it('sends required upstream headers (REQ-POL-07)', async () => {
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    await fetchFromPool(pool, '/search');

    assert.ok(capturedHeaders);
    const headers = capturedHeaders as Record<string, string>;
    assert.strictEqual(headers['x-client'], 'BiniLossless/v3.4');
    assert.strictEqual(headers['Origin'], 'https://monochrome.st');
    assert.strictEqual(headers['Referer'], 'https://monochrome.st/');
    assert.strictEqual(headers['User-Agent'], UPSTREAM_HEADERS['User-Agent']);
  });

  it('throws aggregated error when all candidates fail', async () => {
    globalThis.fetch = async () => {
      return new Response('Down', { status: 503, statusText: 'Service Unavailable' });
    };

    await assert.rejects(
      () => fetchFromPool(pool, '/test'),
      /All upstream candidates failed/
    );
  });
});
