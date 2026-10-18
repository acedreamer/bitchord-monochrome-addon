import { FastifyInstance, FastifyPluginOptions } from 'fastify';

export async function manifestRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
): Promise<void> {
  fastify.get('/manifest.json', async (_request, reply) => {
    reply.header('Content-Type', 'application/json; charset=utf-8');
    return {
      id: 'com.bitchord.addon.monochrome',
      name: 'Monochrome Lossless Provider',
      version: '1.0.0',
      description:
        'Lossless FLAC & Hi-Res audio provider backed by Monochrome HiFi API network.',
      author: 'BitChord Community',
      icon: 'https://monochrome.st/favicon.ico',
      resources: ['search', 'stream', 'settings'],
      types: ['track'],
      contentType: 'music',
      settings: [
        {
          key: 'audio_quality',
          title: 'Preferred Audio Quality',
          type: 'select',
          default: 'LOSSLESS',
          options: [
            {
              label: 'Hi-Res Lossless (24-bit / 192kHz)',
              value: 'HI_RES_LOSSLESS'
            },
            {
              label: 'Lossless FLAC (16-bit / 44.1kHz)',
              value: 'LOSSLESS'
            },
            {
              label: 'High (320kbps AAC)',
              value: 'HIGH'
            }
          ]
        }
      ]
    };
  });
}
