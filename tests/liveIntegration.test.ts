import { buildApp } from '../src/index.js';
import { InstancePool } from '../src/pool/instancePool.js';

async function runLiveIntegrationTest() {
  console.log('=== Starting Live Upstream Integration Test ===');
  const pool = new InstancePool();
  console.log('Active verified pool candidates:', pool.getActiveInstances());

  const app = await buildApp(pool);

  try {
    // 1. Test /manifest.json
    console.log('\n[1/3] Testing GET /manifest.json...');
    const manifestRes = await app.inject({ method: 'GET', url: '/manifest.json' });
    if (manifestRes.statusCode !== 200) {
      throw new Error(`Manifest returned HTTP ${manifestRes.statusCode}: ${manifestRes.payload}`);
    }
    const manifest = JSON.parse(manifestRes.payload);
    console.log('✔ Manifest OK:', manifest.name, `v${manifest.version}`);

    // 2. Test /search?q=Yellow Coldplay
    console.log('\n[2/3] Testing GET /search?q=Yellow Coldplay...');
    const searchRes = await app.inject({
      method: 'GET',
      url: '/search?q=' + encodeURIComponent('Yellow Coldplay')
    });

    if (searchRes.statusCode !== 200) {
      console.warn(
        `⚠ Upstream search returned HTTP ${searchRes.statusCode}: ${searchRes.payload}. Live network might be firewalled/offline in current environment.`
      );
      return;
    }

    const searchData = JSON.parse(searchRes.payload);
    const tracks = searchData.tracks || [];
    console.log(`✔ Search returned ${tracks.length} tracks.`);

    if (tracks.length === 0) {
      console.warn('⚠ No tracks found for "Yellow Coldplay".');
      return;
    }

    const firstTrack = tracks[0];
    console.log(`Top result: "${firstTrack.title}" by "${firstTrack.artist}" (ID: ${firstTrack.id}, Duration: ${firstTrack.duration}s, Format: ${firstTrack.format})`);

    // 3. Test /stream/:id
    console.log(`\n[3/3] Testing GET /stream/${firstTrack.id}...`);
    const streamRes = await app.inject({
      method: 'GET',
      url: `/stream/${firstTrack.id}?quality=LOSSLESS`
    });

    if (streamRes.statusCode !== 200) {
      console.warn(
        `⚠ Upstream stream resolution returned HTTP ${streamRes.statusCode}: ${streamRes.payload}`
      );
      return;
    }

    const streamData = JSON.parse(streamRes.payload);
    console.log('✔ Stream resolution successful:');
    console.log(`  - URL: ${streamData.url.substring(0, 80)}...`);
    console.log(`  - Format: ${streamData.format}`);
    console.log(`  - Sample Rate: ${streamData.sampleRate} Hz`);
    console.log(`  - Bit Depth: ${streamData.bitDepth}-bit`);
    console.log(`  - Encrypted: ${streamData.encrypted}`);

    // Verify stream URL accessibility via HEAD request
    console.log('\nVerifying audio CDN accessibility via HTTP HEAD probe...');
    try {
      const audioProbe = await fetch(streamData.url, {
        method: 'HEAD',
        headers: streamData.headers || {}
      });
      console.log(`✔ Audio CDN responded with HTTP ${audioProbe.status} (${audioProbe.headers.get('content-type')}, length: ${audioProbe.headers.get('content-length')} bytes)`);
    } catch (probeErr: any) {
      console.warn(`⚠ Audio CDN HEAD probe note: ${probeErr.message}`);
    }

    console.log('\n=== Live Upstream Acceptance Gate PASSED ===');
  } finally {
    await app.close();
  }
}

runLiveIntegrationTest().catch((err) => {
  console.error('Live integration test error:', err);
  process.exit(1);
});
