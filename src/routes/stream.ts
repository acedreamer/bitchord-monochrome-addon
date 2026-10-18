import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { InstancePool } from '../pool/instancePool.js';
import { fetchFromPool, ResponseValidator } from '../pool/fetchFromPool.js';
import { decodeStreamManifest } from '../transforms/manifestDecoder.js';

export interface StreamRouteOptions extends FastifyPluginOptions {
  pool: InstancePool;
}

interface StreamParams {
  id: string;
}

interface StreamQuery {
  quality?: string;
  atmos?: string;
}

/**
 * REQ-STR-03: In-loop validator checks assetPresentation !== 'PREVIEW'
 * and !(duration && duration <= 30).
 */
export const streamValidator: ResponseValidator = (json: any) => {
  const trackData = json?.data || json;
  if (!trackData || !trackData.manifest) {
    return { valid: false, reason: 'Missing manifest payload' };
  }
  if (
    trackData.assetPresentation === 'PREVIEW' ||
    (typeof trackData.duration === 'number' && trackData.duration > 0 && trackData.duration <= 30)
  ) {
    return {
      valid: false,
      reason: 'Preview clip detected (token expired or 30s preview)',
      isPreview: true
    };
  }
  return { valid: true };
};

export async function streamRoutes(
  fastify: FastifyInstance,
  options: StreamRouteOptions
): Promise<void> {
  const { pool } = options;

  fastify.get<{ Params: StreamParams; Querystring: StreamQuery }>(
    '/stream/:id',
    async (request, reply) => {
      const { id } = request.params;
      const requestedQuality = request.query.quality || 'LOSSLESS';

      if (!id || id.trim() === '') {
        reply.status(400);
        return { error: 'Track ID parameter is required' };
      }

      try {
        const streamPath = `/track/?id=${encodeURIComponent(id.trim())}&quality=${encodeURIComponent(requestedQuality)}`;
        const { data } = await fetchFromPool(pool, streamPath, {}, streamValidator);
        const trackData = data?.data || data;

        const decoded = decodeStreamManifest(
          trackData.manifest,
          trackData.manifestMimeType || '',
          requestedQuality
        );

        // REQ-STR-06: DASH-to-FLAC Step-Down Handler
        if (decoded.isDash) {
          request.log.info(
            `[Stream] Track ${id}: Hi-Res DASH XML returned; stepping down to LOSSLESS FLAC for BitChord compatibility.`
          );

          const fallbackPath = `/track/?id=${encodeURIComponent(id.trim())}&quality=LOSSLESS`;
          const fallback = await fetchFromPool(pool, fallbackPath, {}, streamValidator);
          const fallbackData = fallback.data?.data || fallback.data;

          const fallbackDecoded = decodeStreamManifest(
            fallbackData.manifest,
            fallbackData.manifestMimeType || '',
            'LOSSLESS'
          );

          if (!fallbackDecoded.stream || fallbackDecoded.isDash) {
            throw new Error('DASH step-down to LOSSLESS did not produce a direct FLAC stream URL');
          }

          return fallbackDecoded.stream;
        }

        if (!decoded.stream) {
          throw new Error('No direct stream URL could be decoded from manifest');
        }

        return decoded.stream;
      } catch (err: any) {
        request.log.error(err, `Stream extraction failed for track ${id}`);
        reply.status(502);
        return {
          error: 'Stream extraction failed',
          details: err.message || 'Unknown upstream stream error'
        };
      }
    }
  );
}
