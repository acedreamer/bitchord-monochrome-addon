import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { HOST, PORT } from './config.js';
import { InstancePool } from './pool/instancePool.js';
import { manifestRoutes } from './routes/manifest.js';
import { searchRoutes } from './routes/search.js';
import { streamRoutes } from './routes/stream.js';

export async function buildApp(customPool?: InstancePool): Promise<FastifyInstance> {
  const isTest = process.env.NODE_ENV === 'test';
  const app = Fastify({
    logger: isTest ? false : true
  });

  // REQ-OPS-02: Enable CORS across all origins
  await app.register(cors, {
    origin: true
  });

  const pool = customPool || new InstancePool();

  // REQ-POL-02: Trigger discovery in background without blocking server boot
  pool.initDynamicDiscovery().catch((err) => {
    if (!isTest) {
      app.log.warn({ err }, 'Dynamic instance discovery failed in background');
    }
  });

  // Core endpoints
  await app.register(manifestRoutes);
  await app.register(searchRoutes, { pool });
  await app.register(streamRoutes, { pool });

  return app;
}

export async function startServer(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Shutting down gracefully...`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    // REQ-OPS-01: Configurable host and port
    const address = await app.listen({ port: PORT, host: HOST });
    app.log.info(`Monochrome BitChord Add-on listening on ${address}`);
  } catch (err) {
    app.log.error(err, 'Failed to start server');
    process.exit(1);
  }
}

// Auto-start when executed directly
if (process.argv[1]) {
  try {
    const currentFilePath = path.resolve(fileURLToPath(import.meta.url));
    const executedFilePath = path.resolve(process.argv[1]);
    if (currentFilePath === executedFilePath) {
      startServer();
    }
  } catch {
    // Ignore URL resolution errors in edge runtime contexts
  }
}
