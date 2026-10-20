import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SimpleCache } from '../src/utils/cache.js';

describe('SimpleCache Utility', () => {
  it('stores and retrieves cached entries', () => {
    const cache = new SimpleCache<string>(10, 5000);
    cache.set('key1', 'value1');

    assert.strictEqual(cache.get('key1'), 'value1');
    assert.strictEqual(cache.has('key1'), true);
  });

  it('returns undefined for nonexistent key', () => {
    const cache = new SimpleCache<string>(10, 5000);
    assert.strictEqual(cache.get('missing'), undefined);
    assert.strictEqual(cache.has('missing'), false);
  });

  it('expires entries after TTL', async () => {
    const cache = new SimpleCache<string>(10, 50); // 50ms TTL
    cache.set('temp', 'tempVal');

    assert.strictEqual(cache.get('temp'), 'tempVal');
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(cache.get('temp'), undefined);
  });

  it('evicts oldest key when maxItems is reached', () => {
    const cache = new SimpleCache<number>(2, 5000);
    cache.set('a', 1);
    cache.set('b', 2);
    assert.strictEqual(cache.size, 2);

    cache.set('c', 3);
    assert.strictEqual(cache.size, 2);
    assert.strictEqual(cache.get('a'), undefined); // Evicted
    assert.strictEqual(cache.get('b'), 2);
    assert.strictEqual(cache.get('c'), 3);
  });

  it('clears all entries', () => {
    const cache = new SimpleCache<string>(10, 5000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();

    assert.strictEqual(cache.size, 0);
    assert.strictEqual(cache.get('a'), undefined);
  });
});
