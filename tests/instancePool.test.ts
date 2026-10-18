import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { InstancePool } from '../src/pool/instancePool.js';
import { DEFAULT_INSTANCES } from '../src/config.js';

describe('InstancePool (REQ-POL-01, REQ-POL-02, REQ-POL-03, REQ-POL-04, REQ-POL-05)', () => {
  const originalEnv = process.env.HIFI_API_INSTANCES;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env.HIFI_API_INSTANCES;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.HIFI_API_INSTANCES = originalEnv;
    } else {
      delete process.env.HIFI_API_INSTANCES;
    }
    globalThis.fetch = originalFetch;
  });

  it('initializes with default verified live nodes at Priority 1 (REQ-POL-03)', () => {
    const pool = new InstancePool();
    const active = pool.getActiveInstances();

    assert.deepStrictEqual(
      active,
      DEFAULT_INSTANCES.map((u) => u.replace(/\/+$/, ''))
    );
  });

  it('respects HIFI_API_INSTANCES environment variable override (REQ-POL-01)', () => {
    process.env.HIFI_API_INSTANCES = 'https://custom1.example.com, https://custom2.example.com/';
    const pool = new InstancePool();
    const active = pool.getActiveInstances();

    assert.deepStrictEqual(active, [
      'https://custom1.example.com',
      'https://custom2.example.com'
    ]);
  });

  it('strictly filters out dead domains (*.monochrome.tf, *.spotisaver.net) (REQ-POL-04)', () => {
    process.env.HIFI_API_INSTANCES =
      'https://frankfurt-1.monochrome.tf, https://hifi-one.spotisaver.net, https://valid.example.com';
    const pool = new InstancePool();
    const active = pool.getActiveInstances();

    assert.deepStrictEqual(active, ['https://valid.example.com']);
  });

  it('dynamic discovery APPENDS nodes behind verified fallback nodes (REQ-POL-02)', async () => {
    const pool = new InstancePool();
    const initialCount = pool.getAllInstances().length;

    // Mock fetch for GitHub instances.json
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('instances.json')) {
        return new Response(
          JSON.stringify({
            api: [
              'https://wolf.qqdl.site', // existing, should not duplicate
              'https://dead.monochrome.tf', // dead, should filter
              'https://new-node-1.example.com',
              'https://new-node-2.example.com/'
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(null, { status: 404 });
    };

    const added = await pool.initDynamicDiscovery(1000);

    assert.deepStrictEqual(added, [
      'https://new-node-1.example.com',
      'https://new-node-2.example.com'
    ]);

    const all = pool.getAllInstances();
    // Confirms initial nodes remained in front (Priority 1)
    assert.strictEqual(all[0], DEFAULT_INSTANCES[0].replace(/\/+$/, ''));
    // Newly discovered nodes were appended at the end
    assert.strictEqual(all[initialCount], 'https://new-node-1.example.com');
    assert.strictEqual(all[initialCount + 1], 'https://new-node-2.example.com');
  });

  it('blacklisting temporarily excludes nodes and auto-expires (REQ-POL-05)', async () => {
    const pool = new InstancePool();
    const target = 'https://wolf.qqdl.site';

    assert.strictEqual(pool.isBlacklisted(target), false);

    // Blacklist for 50ms
    pool.markUnhealthy(target, 50);
    assert.strictEqual(pool.isBlacklisted(target), true);
    assert.ok(!pool.getActiveInstances().includes(target));

    // Wait 60ms for expiry
    await new Promise((r) => setTimeout(r, 60));

    assert.strictEqual(pool.isBlacklisted(target), false);
    assert.ok(pool.getActiveInstances().includes(target));
  });
});
