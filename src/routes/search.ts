import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { InstancePool } from '../pool/instancePool.js';
import { fetchFromPool } from '../pool/fetchFromPool.js';
import { mapHiFiTrackToAddon } from '../transforms/trackMapper.js';
import { UPSTREAM_HEADERS, UPSTREAM_TIMEOUT_MS } from '../config.js';
import { SimpleCache } from '../utils/cache.js';

export interface SearchRouteOptions extends FastifyPluginOptions {
  pool: InstancePool;
}

interface SearchQuery {
  q?: string;
  quality?: string;
  atmos?: string;
}

export const searchCache = new SimpleCache<{ tracks: any[] }>(500, 30 * 60 * 1000);

export async function searchRoutes(
  fastify: FastifyInstance,
  options: SearchRouteOptions
): Promise<void> {
  const { pool } = options;

  fastify.get<{ Querystring: SearchQuery }>('/search', async (request, reply) => {
    const q = request.query.q;

    // REQ-SCH-02: Query parameter validation
    if (!q || typeof q !== 'string' || q.trim() === '') {
      reply.status(400);
      return { error: 'Query parameter "q" is required.' };
    }

    const trimmedQuery = q.trim();
    const cacheKey = trimmedQuery.toLowerCase();

    // Fast-path: In-memory cache hit
    const cached = searchCache.get(cacheKey);
    if (cached) {
      reply.header('X-Cache', 'HIT');
      return cached;
    }

    // 1. Try modern official Monochrome API (tracks.monochrome.st)
    try {
      const tracksUrl = `https://tracks.monochrome.st/search?q=${encodeURIComponent(trimmedQuery)}`;
      const res = await fetch(tracksUrl, {
        headers: {
          'User-Agent': UPSTREAM_HEADERS['User-Agent']
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      });

      if (res.ok) {
        const data: any = await res.json();
        const topTrack = Array.isArray(data?.topResults)
          ? data.topResults.find((item: any) => item?.entityType === 'track' || item?.trackId)
          : null;

        let rawTracks: any[] = Array.isArray(data?.tracks) ? data.tracks : [];
        if (topTrack && !rawTracks.some((t: any) => t.id === topTrack.id)) {
          rawTracks = [topTrack, ...rawTracks];
        }

        // Limit to top 15 results for performance and compact payload
        const slicedTracks = rawTracks.slice(0, 15);
        const tracks = slicedTracks.map((item: any) => mapHiFiTrackToAddon(item));
        searchCache.set(cacheKey, { tracks });
        return { tracks };
      }
    } catch (err: any) {
      request.log.warn({ err }, 'Modern tracks.monochrome.st search failed; falling back to pool');
    }

    // 2. Fallback to HiFi API instance pool
    try {
      const candidates = pool.getActiveInstances();
      if (candidates.length > 0) {
        const searchPath = `/search/?s=${encodeURIComponent(trimmedQuery)}`;
        const { data } = await fetchFromPool(pool, searchPath);

        // Support upstream data formats (data.items or data.data.items)
        const rawItems = Array.isArray(data?.data?.items)
          ? data.data.items
          : Array.isArray(data?.items)
          ? data.items
          : [];

        const slicedItems = rawItems.slice(0, 15);
        const tracks = slicedItems.map((item: any) => mapHiFiTrackToAddon(item));
        searchCache.set(cacheKey, { tracks });

        return { tracks };
      }
    } catch (err: any) {
      request.log.warn({ err }, 'Search upstream fallback failed; returning empty tracks to prevent player lock');
    }

    return { tracks: [] };
  });
}
