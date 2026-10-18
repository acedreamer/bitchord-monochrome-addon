# **Monochrome Provider Add-on Technical Plan for BitChord**

This specification provides a complete, zero-to-production engineering blueprint for AI coding agents to build, test, and deploy a lossless [Monochrome](https://github.com/monochrome-music/monochrome) provider add-on (HTTP source module) for [BitChord](https://github.com/kushagrasinghx/BitChord). Every endpoint, payload schema, and decoding rule in this document is grounded in the upstream BitChord repository, the HTTP Add-on Developer Specification (used across the BitChord and [Wesper](https://github.com/itsmeadarsh2008/wesper) ecosystem), and Monochrome's underlying [HiFi API specification.](https://github.com/arubi9/hifi-api)

# [**1\. System Architecture Translates BitChord HTTP Requests into Monochrome HiFi API Calls**](https://github.com/arubi9/hifi-api)

[Starting in BitChord v1.5.2, BitChord decoupled lossless audio extraction from the core Android and desktop clients by introducin](https://github.com/arubi9/hifi-api)g user-configured HTTP source modules (BitChord README). BitChord handles UI, library management, YouTube Music / Spotify catalog browsing, synced lyrics, and audio output, while delegating lossless stream resolution to external HTTP add-ons ([r/bitchord](https://www.reddit.com/r/bitchord/comments/1wth5lg/flac_situation_needs_to_be_addressed_for_people/)).

[Monochrome](https://github.com/monochrome-music/monochrome) (`https://monochrome.st`) is an open-source web player that streams lossless 16-bit/44.1kHz FLAC (`LOSSLESS`) and up to 24-bit/192kHz Hi-Res FLAC (HI\_RES\_LOSSLESS) by querying a pool of community and official [HiFi API](https://github.com/arubi9/hifi-api) instances ([Echo Music Tidal Guide, octo-fiesta-monochrome).](https://echomusicdocs.vercel.app/docs/tidal)

[Because BitChord cannot talk directly to a raw Monochrome HiFi API endpoint, your add-on acts as a stateless HTTP translation proxy](https://echomusicdocs.vercel.app/docs/tidal):

1. **Discovery & Health Check**: When the user adds your add-on URL in BitChord (`Settings → Sources`) and taps **Test**, BitChord sends `GET /manifest.json` to verify the module is alive and inspect its supported capabilities ([Addon Developer Guide](https://eclipsemusic.app/docs), [r/bitchord](https://www.reddit.com/r/bitchord/comments/1x5nkhc/lastbebe_addon/)).  
2. **Track Matching (`Search` / `Resolve` / `ISRC`)**: When the user plays a track in BitChord, BitChord queries your add-on via `GET /resolve-isrc?isrc={isrc}`, `GET /resolve`, or `GET /search?q={query}`. Your add-on queries an active Monochrome HiFi API instance (`GET /search/?s={query}`), scores the candidates by ISRC, title, artist, and duration, and returns the matched track ID ([Addon Developer Guide](https://eclipsemusic.app/docs), [arubi9/hifi-api](https://github.com/arubi9/hifi-api)).  
3. **Stream Resolution & Manifest Decoding (`Stream`)**: BitChord calls `GET /stream/{id}` on your add-on. Your add-on calls `GET /track/?id={id}&quality={quality}` on the Monochrome HiFi API instance, Base64-decodes the returned `manifest` field, extracts the direct FLAC CDN URL (or serves a decoded MPEG-DASH `.mpd` manifest for 24-bit Hi-Res streams), and returns the playable stream metadata to BitChord ([arubi9/hifi-api](https://github.com/arubi9/hifi-api), [octo-fiesta Issue \#226](https://github.com/V1ck3s/octo-fiesta/issues/226)).

# **2\. Upstream Monochrome & HiFi API Technical Reference**

## **2.1 Instance Pool and Automatic Failover Strategy**

Public HiFi API and Monochrome proxy instances experience periodic rate-limiting, downtime, or upstream TIDAL token expiration ([Monochrome-Android-APK Issue \#8](https://github.com/fabiodalez-dev/Monochrome-Android-APK/issues/8), [Echo Music Tidal Guide](https://echomusicdocs.vercel.app/docs/tidal)). Never hardcode a single upstream URL. Instead, implement an ordered instance pool with a 5-second request timeout and automatic failover, matching the pattern in [octo-fiesta-monochrome](https://github.com/value1338/octo-fiesta-monochrome):

| Priority | Base URL | Region / Purpose | Notes / Source |
| :---- | :---- | :---- | :---- |
| **1** | User-Supplied Env | Dynamic Override | Defined via `HIFI_API_INSTANCES` comma-separated environment variable |
| **2** | `https://frankfurt-1.monochrome.tf` | EU Regional | Primary Monochrome v2.6 node ([octo-fiesta-monochrome](https://github.com/value1338/octo-fiesta-monochrome)) |
| **3** | `https://singapore-1.monochrome.tf` | APAC Regional | Secondary Monochrome v2.6 node ([octo-fiesta-monochrome](https://github.com/value1338/octo-fiesta-monochrome)) |
| **4** | `https://ohio-1.monochrome.tf` | US Regional | Tertiary Monochrome v2.6 node ([octo-fiesta-monochrome](https://github.com/value1338/octo-fiesta-monochrome)) |
| **5** | `https://api.monochrome.tf` | Global Direct | Primary Monochrome v2.5 API ([octo-fiesta-monochrome](https://github.com/value1338/octo-fiesta-monochrome)) |
| **6** | `https://tidal-proxy.monochrome.tf` | Proxy | Fallback Monochrome worker ([octo-fiesta-monochrome](https://github.com/value1338/octo-fiesta-monochrome)) |
| **7** | `https://hifi-one.spotisaver.net` | Mirror | Community HiFi API mirror ([Echo Music Tidal Guide](https://echomusicdocs.vercel.app/docs/tidal)) |
| **8** | `https://hifi-two.spotisaver.net` | Mirror | Secondary SpotiSaver mirror ([Echo Music Tidal Guide](https://echomusicdocs.vercel.app/docs/tidal)) |

### **Critical Upstream Rules**

* **Strip Trailing Slashes**: Always strip trailing `/` characters from base URLs before appending paths (e.g., `url.replace(/\/+$/, '')`).  
* **Origin / Referer Headers**: Official Monochrome instances check request headers to block unauthorized third-party domains ([Monochrome-Android-APK Issue \#8](https://github.com/fabiodalez-dev/Monochrome-Android-APK/issues/8)). Every outgoing fetch to a Monochrome or HiFi API instance **must** include:  
  * `Origin: https://monochrome.st`  
  * `Referer: https://monochrome.st/`  
  * `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`  
* **Preview Cutoff Detection (29-Second Guard)**: When an upstream proxy loses its authenticated user token, TIDAL falls back to returning a 29-second preview clip ([arubi9/hifi-api](https://github.com/arubi9/hifi-api)). If `track.duration` (or extracted stream duration) is `<= 30` seconds while the target track duration is longer than 45 seconds, treat the response as an invalid preview error, mark that instance as unhealthy for 5 minutes, and fail over to the next URL in the pool.

## **2.2 Upstream Monochrome / hifi-api Endpoints**

### **1\. Track Search**

* **Endpoint**: `GET {instance}/search/?s={query}`  
* **Upstream Response Structure**:{  
    
    "data": {  
    
      "items": \[  
    
        {  
    
          "id": 142283478,  
    
          "title": "Yellow",  
    
          "duration": 266,  
    
          "isrc": "GBAYE0000038",  
    
          "explicit": false,  
    
          "audioModes": \["STEREO"\],  
    
          "mediaMetadata": { "tags": \["LOSSLESS"\] },  
    
          "artist": { "id": 14223, "name": "Coldplay" },  
    
          "artists": \[{ "id": 14223, "name": "Coldplay" }\],  
    
          "album": {  
    
            "id": 142283472,  
    
            "title": "Parachutes",  
    
            "cover": "4e73f2aa-a392-4217-9150-14e4b4764834"  
    
          }  
    
        }  
    
      \]  
    
    }  
    
  }

### **2\. Artwork URL Reconstruction**

Monochrome and TIDAL return raw album cover UUIDs (e.g., 4e73f2aa-a392-4217-9150-14e4b4764834). Convert these UUIDs to canonical CDN image URLs by replacing all hyphens with forward slashes ([octo-fiesta-monochrome](https://github.com/value1338/octo-fiesta-monochrome)):https\://resources.tidal.com/images/\${cover.replace(/-/g, '/')}/640x640.jpg

### **3\. Lossless Stream Retrieval**

* **Endpoint**: `GET {instance}/track/?id={id}&quality={quality}`  
* **Allowed Quality Values**: `HI_RES_LOSSLESS` (24-bit/192kHz max), `LOSSLESS` (16-bit/44.1kHz FLAC), `HIGH` (320kbps AAC), `LOW` (96kbps AAC). Default to `LOSSLESS` for maximum compatibility across devices, or attempt `HI_RES_LOSSLESS` with fallback to `LOSSLESS` ([arubi9/hifi-api](https://github.com/arubi9/hifi-api)).  
* **Upstream Response Payload**:{  
    
    "data": {  
    
      "trackId": 142283478,  
    
      "assetPresentation": "FULL",  
    
      "audioQuality": "LOSSLESS",  
    
      "manifestMimeType": "application/vnd.tidal.bts",  
    
      "manifest": "eyJtaW1lVHlwZSI6ImF1ZGlvL2ZsYWMiLCJjb2RlY3MiOiJmbGFjIiwic2FtcGxlUmF0ZSI6NDQxMDAsImJpdERlcHRoIjoxNiwidXJscyI6WyJodHRwczovL3N3aWZ0LXRsZC50aWRhbC5jb20vYXVkaW8vLi4uZmxhYyJdfQ=="  
    
    }  
    
  }

### **4\. Decoding the `manifest` Payload**

The `manifest` string is a Base64-encoded JSON or XML document ([octo-fiesta Issue \#226](https://github.com/V1ck3s/octo-fiesta/issues/226)).

#### **Case A: Direct FLAC Stream (`manifestMimeType === "application/vnd.tidal.bts"`)**

Decoded JSON payload structure:{

  "mimeType": "audio/flac",

  "codecs": "flac",

  "encryptionType": "NONE",

  "sampleRate": 44100,

  "bitDepth": 16,

  "urls": \[

    "https\://swift-tld.tidal.com/audio/sample-flac-stream-url.flac?token=..."

  \]

}

* **Extraction Strategy**:  
  1. Base64-decode `manifest` string into UTF-8 JSON.  
  2. Parse JSON and select `urls[0]`.  
  3. Return direct FLAC link to BitChord with metadata: `manifest: "none"`, `codec: "flac"`, `sampleRate: 44100`, `bitDepth: 16`.

#### **Case B: MPEG-DASH Hi-Res Stream (`manifestMimeType === "application/dash+xml"`)**

Decoded payload is raw XML string containing MPEG-DASH representation data.

* **Extraction Strategy**:  
  * **Option 1 (Recommended)**: Pass decoded XML directly or proxy as a data URI / endpoint (`/dash/{id}.mpd`), setting `manifest: "dash"` for BitChord's ExoPlayer to consume.  
  * **Option 2 (Fallback Step-Down)**: If MPEG-DASH client parsing fails or is disabled, immediately re-request stream with `quality=LOSSLESS` to force a direct `application/vnd.tidal.bts` FLAC URL.

# **3\. BitChord Add-on Server Contract (Downstream Specification)**

BitChord expects HTTP add-ons to adhere to the standard Eclipse/BitChord Add-on Protocol ([Addon Developer Guide](https://eclipsemusic.app/docs)). The add-on must run an HTTP server responding on the endpoints below.

## **3.1 Endpoint Summary**

| Endpoint | HTTP Method | Query / Path Parameters | Purpose |
| :---- | :---- | :---- | :---- |
| `/manifest.json` | `GET` | None | Module discovery, capabilities declaration, and version metadata |
| `/search` | `GET` | `?q={query}` | Free-text search across tracks |
| `/resolve-isrc` | `GET` | `?isrc={isrc}` | Strict ISRC lookup for instant matching |
| `/resolve` | `GET` | `?isrc={isrc}&title={title}&artist={artist}&durationMs={ms}` | Smart multi-parameter track resolution |
| `/stream/{id}` | `GET` | Path param `{id}` (`?quality={q}`) | Direct FLAC audio URL resolution |

## **3.2 Add-on Manifest Endpoint**

BitChord queries `/manifest.json` upon adding the source module to validate capabilities ([Addon Developer Guide](https://eclipsemusic.app/docs)).GET /manifest.json HTTP/1.1

Host: localhost:8080

### **Response Header**

`Content-Type: application/json; charset=utf-8`

### **Response Body**

{

  "id": "com.bitchord.addon.monochrome",

  "name": "Monochrome Lossless Provider",

  "version": "1.0.0",

  "description": "High-fidelity FLAC & Hi-Res audio provider backed by Monochrome HiFi API network.",

  "author": "BitChord Community",

  "icon": "https\://monochrome.st/favicon.ico",

  "resources": \["search", "stream", "isrc", "resolve", "settings"\],

  "types": \["track"\],

  "contentType": "music",

  "settings": \[

    {

      "key": "audio\_quality",

      "title": "Preferred Audio Quality",

      "type": "select",

      "default": "LOSSLESS",

      "options": \[

        { "label": "Hi-Res Lossless (24-bit / 192kHz)", "value": "HI\_RES\_LOSSLESS" },

        { "label": "Lossless FLAC (16-bit / 44.1kHz)", "value": "LOSSLESS" },

        { "label": "High (320kbps AAC)", "value": "HIGH" }

      \]

    }

  \]

}

## **3.3 Free-Text Search Endpoint**

GET /search?q=Coldplay%20Yellow HTTP/1.1

Host: localhost:8080

### **Add-on Processing Logic**

1. Receive search query `q`.  
2. Send `GET {instance}/search/?s={encodeURIComponent(q)}` to Monochrome instance pool.  
3. Transform array of results into BitChord Standard Track format.

### **Response Header**

`Content-Type: application/json; charset=utf-8`

### **Response Body**

{

  "tracks": \[

    {

      "id": "142283478",

      "title": "Yellow",

      "artist": "Coldplay",

      "album": "Parachutes",

      "duration": 266000,

      "artworkURL": "https\://resources.tidal.com/images/4e73f2aa/a392/4217/9150/14e4b4764834/640x640.jpg",

      "isrc": "GBAYE0000038",

      "format": "flac",

      "quality": "16-bit / 44.1kHz"

    }

  \]

}

## **3.4 Strict ISRC Resolution Endpoint**

BitChord calls `/resolve-isrc` when a Spotify or YouTube track has an embedded ISRC code ([r/bitchord](https://www.reddit.com/r/bitchord/comments/1wth5lg/flac_situation_needs_to_be_addressed_for_people/)).GET /resolve-isrc?isrc=GBAYE0000038 HTTP/1.1

Host: localhost:8080

### **Add-on Processing Logic**

1. Clean parameter `isrc = isrc.replace(/[^A-Z0-9]/gi, '').toUpperCase()`.  
2. Query `{instance}/search/?s={isrc}`.  
3. Iterate through `data.items`. If `item.isrc === cleaned_isrc`, return exact match immediately.  
4. If no exact match found, return `{ "trackId": null }`.

### **Response Body (Match Found)**

{

  "trackId": "142283478",

  "id": "142283478",

  "isrc": "GBAYE0000038",

  "title": "Yellow",

  "artist": "Coldplay",

  "duration": 266000

}

### **Response Body (No Match Found)**

{

  "trackId": null

}

## **3.5 Metadata Match & Fallback Resolution Endpoint**

When ISRC matching fails or is omitted, BitChord sends fuzzy metadata to `/resolve` ([Addon Developer Guide](https://eclipsemusic.app/docs)).GET /resolve?isrc=GBAYE0000038\&title=Yellow\&artist=Coldplay\&durationMs=266733 HTTP/1.1

Host: localhost:8080

### **Scoring & Matching Algorithm Rules**

1. **First Pass (ISRC Lookup)**: If `isrc` query param is supplied, execute ISRC match logic first. If match found, return it.  
2. **Second Pass (Text Search & Distance Scoring)**:  
   * Execute search with `{title} {artist}`.  
   * Normalize strings: convert to lowercase, strip punctuation, remove parenthetical suffixes like `(Remastered 2011)`, `(Live)`, `- Single Version`.  
   * **Duration Guard**: Reject any candidate where `Math.abs(candidate.duration * 1000 - durationMs) > 5000` (5-second threshold).  
   * Calculate string similarity scores for `title` and `artist` using Levenshtein distance or token overlap.  
   * Select candidate with highest combined composite score above threshold `0.75`.

### **Response Body**

{

  "trackId": "142283478",

  "id": "142283478",

  "confidence": 0.98,

  "matchedBy": "isrc",

  "track": {

    "id": "142283478",

    "title": "Yellow",

    "artist": "Coldplay",

    "album": "Parachutes",

    "duration": 266000,

    "artworkURL": "https\://resources.tidal.com/images/4e73f2aa/a392/4217/9150/14e4b4764834/640x640.jpg",

    "isrc": "GBAYE0000038"

  }

}

## **3.6 Lossless Stream Resolution Endpoint**

Called by BitChord to retrieve playable stream metadata for track `id` ([Addon Developer Guide](https://eclipsemusic.app/docs)).GET /stream/142283478?quality=LOSSLESS HTTP/1.1

Host: localhost:8080

### **Add-on Processing Logic**

1. Extract `id` path parameter and optional `quality` query string (default to `LOSSLESS`).  
2. Query `GET {instance}/track/?id={id}&quality={quality}` with required upstream headers (`Origin: https://monochrome.st`).  
3. Handle Base64 `manifest` string decoding as defined in Section 2.2.  
4. Construct direct BitChord Audio Stream response.

### **Response Body (Direct FLAC Audio Stream)**

{

  "url": "https\://swift-tld.tidal.com/audio/sample-flac-stream-url.flac?token=...",

  "format": "flac",

  "quality": "LOSSLESS",

  "mimeType": "audio/flac",

  "manifest": "none",

  "sampleRate": 44100,

  "bitDepth": 16,

  "headers": {

    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"

  },

  "expiresAt": 1711900000

}

### **Response Body (Hi-Res MPEG-DASH Manifest)**

{

  "url": "https\://localhost:8080/dash/142283478.mpd",

  "format": "dash",

  "quality": "HI\_RES\_LOSSLESS",

  "mimeType": "application/dash+xml",

  "manifest": "dash",

  "sampleRate": 96000,

  "bitDepth": 24

}

# **4\. Complete Node.js / TypeScript Reference Implementation**

A complete, production-ready implementation written in Node.js (TypeScript) using `fastify` and native `fetch`.

## **4.1 Prerequisites & Configuration**

`package.json`:{

  "name": "bitchord-monochrome-addon",

  "version": "1.0.0",

  "description": "Lossless Monochrome Provider Addon for BitChord",

  "main": "dist/index.js",

  "type": "module",

  "scripts": {

    "build": "tsc",

    "start": "node dist/index.js",

    "dev": "tsx watch src/index.ts"

  },

  "dependencies": {

    "fastify": "^4.26.0",

    "@fastify/cors": "^9.0.0"

  },

  "devDependencies": {

    "@types/node": "^20.11.0",

    "tsx": "^4.7.0",

    "typescript": "^5.3.3"

  }

}

## **4.2 Application Code (`src/index.ts`)**

import Fastify from 'fastify';

import cors from '@fastify/cors';

const PORT \= parseInt(process.env.PORT || '8080', 10);

const HOST \= process.env.HOST || '0.0.0.0';

// Configure Upstream Instance Pool

const DEFAULT\_INSTANCES \= \[

  'https\://frankfurt-1.monochrome.tf',

  'https\://singapore-1.monochrome.tf',

  'https\://ohio-1.monochrome.tf',

  'https\://api.monochrome.tf',

  'https\://tidal-proxy.monochrome.tf',

  'https\://hifi-one.spotisaver.net',

  'https\://hifi-two.spotisaver.net'

\];

const INSTANCE\_POOL: string\[\] \= process.env.HIFI\_API\_INSTANCES

  ? process.env.HIFI\_API\_INSTANCES.split(',').map((s) \=\> s.trim())

  : DEFAULT\_INSTANCES;

// Blacklist tracking for unhealthy nodes

const blacklistedInstances \= new Map\<string, number\>();

function getActiveInstances(): string\[\] {

  const now \= Date.now();

  return INSTANCE\_POOL.filter((url) \=\> {

    const until \= blacklistedInstances.get(url);

    if (\!until) return true;

    if (now \> until) {

      blacklistedInstances.delete(url);

      return true;

    }

    return false;

  });

}

function markInstanceUnhealthy(url: string, durationMs \= 300000\) {

  console.warn(\`\[Failover\] Marking instance unhealthy for \${durationMs}ms: \${url}\`);

  blacklistedInstances.set(url, Date.now() \+ durationMs);

}

// Utility: Execute upstream fetch with automatic failover

async function fetchFromPool(pathAndQuery: string, options: RequestInit \= {}): Promise\<{ data: any; instance: string }\> {

  const candidates \= getActiveInstances();

  if (candidates.length \=== 0\) {

    throw new Error('All Monochrome/HiFi API upstream instances are currently blacklisted or unavailable.');

  }

  let lastError: Error | null \= null;

  for (const baseUrl of candidates) {

    const cleanBase \= baseUrl.replace(/\\/+\$/, '');

    const targetUrl \= \`\${cleanBase}\${pathAndQuery.startsWith('/') ? '' : '/'}\${pathAndQuery}\`;

    const controller \= new AbortController();

    const timeoutId \= setTimeout(() \=\> controller.abort(), 5000); // 5-second timeout

    try {

      const response \= await fetch(targetUrl, {

        ...options,

        signal: controller.signal,

        headers: {

          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',

          'Origin': 'https\://monochrome.st',

          'Referer': 'https\://monochrome.st/',

          ...(options.headers || {})

        }

      });

      clearTimeout(timeoutId);

      if (\!response.ok) {

        throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);

      }

      const json: any \= await response.json();

      return { data: json, instance: cleanBase };

    } catch (err: any) {

      clearTimeout(timeoutId);

      console.warn(\`\[Upstream Error\] \${cleanBase}: \${err.message}\`);

      markInstanceUnhealthy(cleanBase, 180000); // 3-minute temporary cooldown

      lastError \= err;

    }

  }

  throw new Error(\`All upstream instances failed. Last error: \${lastError?.message}\`);

}

// Format Album Cover UUID to Tidal CDN URL

function formatCoverUrl(coverUuid?: string): string | null {

  if (\!coverUuid) return null;

  const path \= coverUuid.replace(/-/g, '/');

  return \`https\://resources.tidal.com/images/\${path}/640x640.jpg\`;

}

// Normalize strings for metadata comparison

function normalizeStr(str: string): string {

  return str

    .toLowerCase()

    .replace(/\\(.\*?remastered.\*?\\)/gi, '')

    .replace(/\\(.\*?live.\*?\\)/gi, '')

    .replace(/\[^a-z0-9\\s\]/gi, '')

    .trim();

}

// Initialize Fastify Server

const app \= Fastify({ logger: true });

await app.register(cors, { origin: true });

// 1\. Add-on Manifest

app.get('/manifest.json', async () \=\> {

  return {

    id: 'com.bitchord.addon.monochrome',

    name: 'Monochrome Lossless Provider',

    version: '1.0.0',

    description: 'Stateless lossless audio proxy bridging BitChord and Monochrome HiFi networks.',

    author: 'BitChord Community',

    icon: 'https\://monochrome.st/favicon.ico',

    resources: \['search', 'stream', 'isrc', 'resolve', 'settings'\],

    types: \['track'\],

    contentType: 'music',

    settings: \[

      {

        key: 'audio\_quality',

        title: 'Audio Quality',

        type: 'select',

        default: 'LOSSLESS',

        options: \[

          { label: 'Hi-Res Lossless (24-bit / 192kHz)', value: 'HI\_RES\_LOSSLESS' },

          { label: 'Lossless FLAC (16-bit / 44.1kHz)', value: 'LOSSLESS' },

          { label: 'High (320kbps AAC)', value: 'HIGH' }

        \]

      }

    \]

  };

});

// 2\. Search Endpoint

app.get\<{ Querystring: { q?: string } }\>('/search', async (req, reply) \=\> {

  const query \= req.query.q;

  if (\!query) return reply.status(400).send({ error: 'Query parameter "q" is required.' });

  try {

    const { data } \= await fetchFromPool(\`/search/?s=\${encodeURIComponent(query)}\`);

    const items \= data?.data?.items || data?.items || \[\];

    const tracks \= items.map((item: any) \=\> ({

      id: String(item.id),

      title: item.title,

      artist: item.artist?.name || item.artists?.\[0\]?.name || 'Unknown Artist',

      album: item.album?.title || '',

      duration: (item.duration || 0\) \* 1000,

      artworkURL: formatCoverUrl(item.album?.cover),

      isrc: item.isrc || null,

      format: 'flac',

      quality: item.mediaMetadata?.tags?.includes('HIRES\_LOSSLESS') ? '24-bit Hi-Res' : '16-bit FLAC'

    }));

    return { tracks };

  } catch (err: any) {

    req.log.error(err);

    return reply.status(502).send({ error: 'Failed to search upstream Monochrome instances.', details: err.message });

  }

});

// 3\. ISRC Exact Resolution

app.get\<{ Querystring: { isrc?: string } }\>('/resolve-isrc', async (req, reply) \=\> {

  const isrc \= req.query.isrc;

  if (\!isrc) return reply.status(400).send({ error: 'ISRC parameter is required.' });

  const cleanIsrc \= isrc.replace(/\[^A-Z0-9\]/gi, '').toUpperCase();

  try {

    const { data } \= await fetchFromPool(\`/search/?s=\${encodeURIComponent(cleanIsrc)}\`);

    const items \= data?.data?.items || data?.items || \[\];

    const exactMatch \= items.find((item: any) \=\> item.isrc && item.isrc.replace(/\[^A-Z0-9\]/gi, '').toUpperCase() \=== cleanIsrc);

    if (exactMatch) {

      return {

        trackId: String(exactMatch.id),

        id: String(exactMatch.id),

        isrc: exactMatch.isrc,

        title: exactMatch.title,

        artist: exactMatch.artist?.name || exactMatch.artists?.\[0\]?.name || '',

        duration: (exactMatch.duration || 0\) \* 1000

      };

    }

    return { trackId: null };

  } catch (err: any) {

    return { trackId: null, error: err.message };

  }

});

// 4\. Metadata Fuzzy Resolution

app.get\<{ Querystring: { isrc?: string; title?: string; artist?: string; durationMs?: string } }\>('/resolve', async (req, reply) \=\> {

  const { isrc, title, artist, durationMs } \= req.query;

  const targetDuration \= durationMs ? parseInt(durationMs, 10\) : null;

  // Pass 1: Try ISRC if provided

  if (isrc) {

    const cleanIsrc \= isrc.replace(/\[^A-Z0-9\]/gi, '').toUpperCase();

    try {

      const { data } \= await fetchFromPool(\`/search/?s=\${encodeURIComponent(cleanIsrc)}\`);

      const items \= data?.data?.items || data?.items || \[\];

      const exact \= items.find((item: any) \=\> item.isrc && item.isrc.replace(/\[^A-Z0-9\]/gi, '').toUpperCase() \=== cleanIsrc);

      if (exact) {

        return {

          trackId: String(exact.id),

          id: String(exact.id),

          confidence: 1.0,

          matchedBy: 'isrc'

        };

      }

    } catch (\_) { /\* proceed to text search \*/ }

  }

  // Pass 2: Fuzzy Metadata Search

  if (\!title) return reply.status(400).send({ error: 'Title or ISRC is required for track resolution.' });

  const searchQuery \= \`\${title} \${artist || ''}\`.trim();

  try {

    const { data } \= await fetchFromPool(\`/search/?s=\${encodeURIComponent(searchQuery)}\`);

    const items \= data?.data?.items || data?.items || \[\];

    const normTitle \= normalizeStr(title);

    const normArtist \= artist ? normalizeStr(artist) : '';

    let bestCandidate: any \= null;

    let highestScore \= 0;

    for (const item of items) {

      const itemDurationMs \= (item.duration || 0\) \* 1000;

      // 29-Second Guard / Duration Match Filter

      if (targetDuration && Math.abs(itemDurationMs \- targetDuration) \> 5000\) {

        continue; // Skip tracks that deviate by \> 5 seconds

      }

      const itemTitle \= normalizeStr(item.title || '');

      const itemArtist \= normalizeStr(item.artist?.name || item.artists?.\[0\]?.name || '');

      let score \= 0;

      if (itemTitle \=== normTitle) score \+= 0.6;

      else if (itemTitle.includes(normTitle) || normTitle.includes(itemTitle)) score \+= 0.4;

      if (normArtist && itemArtist \=== normArtist) score \+= 0.4;

      else if (normArtist && (itemArtist.includes(normArtist) || normArtist.includes(itemArtist))) score \+= 0.2;

      if (score \> highestScore && score \>= 0.6) {

        highestScore \= score;

        bestCandidate \= item;

      }

    }

    if (bestCandidate) {

      return {

        trackId: String(bestCandidate.id),

        id: String(bestCandidate.id),

        confidence: highestScore,

        matchedBy: 'metadata',

        track: {

          id: String(bestCandidate.id),

          title: bestCandidate.title,

          artist: bestCandidate.artist?.name || bestCandidate.artists?.\[0\]?.name,

          duration: (bestCandidate.duration || 0\) \* 1000

        }

      };

    }

    return reply.status(404).send({ error: 'No matching track found meeting duration and metadata thresholds.' });

  } catch (err: any) {

    return reply.status(502).send({ error: 'Resolution failed.', details: err.message });

  }

});

// 5\. Stream Endpoint

app.get\<{ Params: { id: string }; Querystring: { quality?: string } }\>('/stream/:id', async (req, reply) \=\> {

  const trackId \= req.params.id;

  const quality \= req.query.quality || 'LOSSLESS';

  try {

    const { data, instance } \= await fetchFromPool(\`/track/?id=\${trackId}\&quality=\${quality}\`);

    const trackData \= data?.data || data;

    if (\!trackData || \!trackData.manifest) {

      throw new Error('Upstream response missing stream manifest payload.');

    }

    // Guard: Check for 29-second preview limit token failure

    if (trackData.duration && trackData.duration \<= 30\) {

      markInstanceUnhealthy(instance, 300000);

      throw new Error('Upstream instance returned a 29-second preview clip.');

    }

    const mimeType \= trackData.manifestMimeType || '';

    const rawManifestBase64 \= trackData.manifest;

    const decodedManifestStr \= Buffer.from(rawManifestBase64, 'base64').toString('utf-8');

    // Scenario A: Direct FLAC Stream Payload (application/vnd.tidal.bts)

    if (mimeType.includes('vnd.tidal.bts') || decodedManifestStr.startsWith('{')) {

      const manifestJson \= JSON.parse(decodedManifestStr);

      const audioUrl \= manifestJson.urls?.\[0\];

      if (\!audioUrl) throw new Error('No direct stream URL present in decoded manifest JSON.');

      return {

        url: audioUrl,

        format: 'flac',

        quality: trackData.audioQuality || quality,

        mimeType: 'audio/flac',

        manifest: 'none',

        sampleRate: manifestJson.sampleRate || 44100,

        bitDepth: manifestJson.bitDepth || 16,

        headers: {

          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

        }

      };

    }

    // Scenario B: MPEG-DASH XML Manifest Payload (application/dash+xml)

    if (mimeType.includes('dash+xml') || decodedManifestStr.startsWith('\<MPD')) {

      return {

        url: \`data:application/dash+xml;base64,\${rawManifestBase64}\`,

        format: 'dash',

        quality: trackData.audioQuality || 'HI\_RES\_LOSSLESS',

        mimeType: 'application/dash+xml',

        manifest: 'dash',

        sampleRate: 96000,

        bitDepth: 24

      };

    }

    throw new Error(\`Unsupported stream manifest type: \${mimeType}\`);

  } catch (err: any) {

    req.log.error(\`Stream extraction failed for track \${trackId}: \${err.message}\`);

    return reply.status(502).send({ error: 'Failed to extract stream.', details: err.message });

  }

});

// Start Server

app.listen({ port: PORT, host: HOST }, (err, address) \=\> {

  if (err) {

    app.log.error(err);

    process.exit(1);

  }

  console.log(\`🚀 BitChord Monochrome Provider Add-on running at \${address}\`);

});

# **5\. Agent Execution Plan & Verification Checklist**

AI coding agents executing this specification should follow these steps:

## **Milestone 1: Upstream Instance Health Verification**

- [ ] Send `GET` request to `https://frankfurt-1.monochrome.tf/search/?s=Coldplay+Yellow` with header `Origin: https://monochrome.st`.  
- [ ] Confirm JSON response contains `data.items[0].id` and valid album cover UUID.

## **Milestone 2: Add-on Server Scaffolding**

- [ ] Initialize Node.js TypeScript workspace with Fastify and CORS middleware.  
- [ ] Implement `GET /manifest.json` and verify payload matches standard add-on schema.

## **Milestone 3: Search, ISRC, and Resolution Verification**

- [ ] Test `GET /search?q=Yellow+Coldplay` and verify artwork URL transformation (`https://resources.tidal.com/images/...`).  
- [ ] Test `GET /resolve-isrc?isrc=GBAYE0000038` and verify return of track ID `142283478`.  
- [ ] Test `GET /resolve?title=Yellow&artist=Coldplay&durationMs=266000` and verify scoring logic filters tracks with duration mismatch \> 5s.

## **Milestone 4: Stream Decoding Verification**

- [ ] Test `GET /stream/142283478?quality=LOSSLESS`.  
- [ ] Confirm Base64 `manifest` string decodes to valid JSON containing a direct FLAC `urls[0]` link.  
- [ ] Confirm standard response metadata includes `format: "flac"` and `mimeType: "audio/flac"`.

## **Milestone 5: Integration Testing in BitChord Client**

- [ ] Deploy add-on to accessible HTTP endpoint (e.g., local LAN `http://192.168.1.50:8080`, Cloudflare Workers, or Deno Deploy).  
- [ ] Open BitChord app (`Settings → Sources → Add Source`).  
- [ ] Enter add-on URL, tap **Test**, and ensure successful validation check mark.  
- [ ] Play track in BitChord, open Audio Info overlay, and confirm **FLAC 16-bit / 44.1kHz** badge is active.

