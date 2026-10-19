import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { InstancePool } from '../pool/instancePool.js';
import { fetchFromPool } from '../pool/fetchFromPool.js';
import { mapHiFiTrackToAddon } from '../transforms/trackMapper.js';
import { UPSTREAM_HEADERS, UPSTREAM_TIMEOUT_MS } from '../config.js';

export interface SearchRouteOptions extends FastifyPluginOptions {
  pool: InstancePool;
}

interface SearchQuery {
  q?: string;
  quality?: string;
  atmos?: string;
}

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
        const rawTracks = Array.isArray(data?.tracks) ? data.tracks : [];
        const tracks = rawTracks.map((item: any) => mapHiFiTrackToAddon(item));
        return { tracks };
      }
    } catch (err: any) {
      request.log.warn({ err }, 'Modern tracks.monochrome.st search failed; falling back to pool');
    }

    // 2. Fallback to HiFi API instance pool
    try {
      const searchPath = `/search/?s=${encodeURIComponent(trimmedQuery)}`;
      const { data } = await fetchFromPool(pool, searchPath);

      // Support upstream data formats (data.items or data.data.items)
      const rawItems = Array.isArray(data?.data?.items)
        ? data.data.items
        : Array.isArray(data?.items)
        ? data.items
        : [];

      const tracks = rawItems.map((item: any) => mapHiFiTrackToAddon(item));

      return { tracks };
    } catch (err: any) {
      request.log.error(err, 'Search upstream failure');
      reply.status(502);
      return {
        error: 'Upstream search failed',
        details: err.message || 'Unknown upstream error'
      };
    }
  });
}
