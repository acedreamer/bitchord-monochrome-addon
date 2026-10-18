# Monochrome Provider Add-on — Spec-Driven Implementation Plan

**Document Version:** 1.2.0  
**Status:** Approved for Implementation (Critical Architectural & Wire Protocol Revisions Applied)  
**Specification Reference:** [`Monochrome Provider Validated Spec Plan.md`](file:///F:/bitchord/provider/Monochrome%20Provider%20Validated%20Spec%20Plan.md)  
**Target System:** BitChord v1.5.2+ Lossless HTTP Source Module  
**Runtime Environment:** Node.js 20+ (Targeting Node.js v24.13.0 on Windows/Linux), TypeScript 5.3+ (ESM / NodeNext), Fastify 4.x  
**Repository Platform:** GitHub (Git Flow / GitHub Flow with automated CI/CD and GHCR publishing)  

---

## 1. Specification Summary and Version

This implementation plan governs the end-to-end development, verification, GitHub repository setup, CI/CD pipeline, and deployment readiness of the **Monochrome Provider Add-on** for BitChord. The add-on functions as a stateless HTTP translation proxy between BitChord clients (Android/Desktop) and the community Monochrome / HiFi API network, delivering lossless 16-bit/44.1kHz FLAC and Hi-Res audio streams.

### Core Architectural Decisions Enforced by the Specification
1. **Three-Endpoint Wire Protocol**: Strictly adheres to BitChord's native add-on specification (`AddonClient.kt`, `AddonSource.kt`) by exposing only `GET /manifest.json`, `GET /search`, and `GET /stream/:id`. All candidate scoring and matching are handled client-side by BitChord's `TrackMatcher.kt`.
2. **Corrected Units**: Enforces audio track duration representation strictly in **seconds (floating point / double)** rather than milliseconds, avoiding track duration mismatch failures.
3. **Validated Live Instance Pool & Priority Order**: Verified live HiFi API nodes (`*.qqdl.site` and `tidal.kinoplus.online`) are maintained at **Priority 1**. Dynamically discovered nodes from Monochrome's GitHub registry are **appended** behind verified nodes (not prepended) to protect user requests from unverified node timeouts.
4. **Integrated In-Loop Preview Guard Failover**: Prevents truncated audio playback by embedding validation directly inside `fetchFromPool`. When an upstream node returns HTTP 200 with `assetPresentation === "PREVIEW"`, `fetchFromPool` immediately blacklists the node for 300,000ms and **automatically retries the next candidate in the pool loop**, ensuring the client never receives an premature HTTP 502.
5. **DASH-to-FLAC Step-Down (Strict HTTP/HTTPS URLs)**: BitChord's `AddonSource.kt` enforces `ModuleSource.malformed(url)` via `toHttpUrlOrNull()`, which strictly rejects `data:` URI schemes. When an upstream Hi-Res stream returns MPEG-DASH XML, the add-on automatically steps down to query `quality=LOSSLESS` to extract a direct, unencrypted `https://...flac` stream URL on TIDAL's Swift CDN with `encrypted: false`, guaranteeing full playback compatibility in ExoPlayer.
6. **ESM NodeNext Compliance**: Adheres to TypeScript `NodeNext` module resolution by requiring explicit `.js` extensions on all local relative imports (e.g., `import { config } from './config.js'`).
7. **Production DevOps & Docker Multi-Stage Hygiene**: Stage 2 runner copies both `package.json` and `package-lock.json` before running `npm ci --omit=dev`. Includes multi-version GitHub Actions CI (Node 20, 22, 24), GHCR multi-arch container publishing, Dependabot, and 1-click cloud deploy blueprints (`render.yaml`, `railway.json`).

---

## 2. Requirements Inventory

| Requirement ID | Specification Section | Category | Description | Acceptance Criteria |
|---|---|---|---|---|
| **REQ-MAN-01** | §4.1 | Manifest | Expose `GET /manifest.json` endpoint | Returns HTTP 200 with `Content-Type: application/json; charset=utf-8`. |
| **REQ-MAN-02** | §4.1 | Manifest | Manifest identity and metadata schema | Payload contains exact keys: `id: "com.bitchord.addon.monochrome"`, `name`, `version`, `description`, `author`, `icon`, `contentType: "music"`, `types: ["track"]`. |
| **REQ-MAN-03** | §4.1 | Manifest | Accurate resource declaration | `resources` array contains strictly `["search", "stream", "settings"]`. Does NOT declare non-functional `"isrc"` or `"resolve"`. |
| **REQ-MAN-04** | §4.1 | Manifest | Audio quality setting declaration | `settings` array declares `audio_quality` select input with options `HI_RES_LOSSLESS`, `LOSSLESS` (default), and `HIGH`. |
| **REQ-SCH-01** | §4.2 | Search | Expose `GET /search` endpoint | Accepts query parameters `q` (string, required), `quality` (string, optional), `atmos` (string, optional). |
| **REQ-SCH-02** | §4.2 | Search | Query parameter validation | If `q` is absent or whitespace only, returns HTTP 400 with `{ error: "Query parameter \"q\" is required." }`. |
| **REQ-SCH-03** | §4.2, §7.4 | Search | Upstream query transformation | Queries upstream via `GET /search/?s={encodeURIComponent(q)}` using active instance pool with failover. |
| **REQ-SCH-04** | §4.2, §7.4 | Search | Track entity mapping | Maps upstream `data.items` to `{ tracks: AddonTrack[] }` schema with `id`, `title`, `artist`, `album`, `format: "flac"`, and `audioQuality`. |
| **REQ-SCH-05** | §4.2, §1 C2 | Search | Duration in seconds enforcement | Maps track duration strictly in **seconds** (`item.duration`), never multiplying by 1000. |
| **REQ-SCH-06** | §4.2, §7.6 | Search | Artwork URL reconstruction | Reconstructs album cover UUID into `https://resources.tidal.com/images/{uuid-with-slashes}/640x640.jpg`. Returns null if UUID is absent. |
| **REQ-SCH-07** | §4.2 | Search | Extra metadata passthrough | Pass through `isrc` as informational extra field (leniently ignored by BitChord's parser per `AddonModels.kt:25`). |
| **REQ-SCH-08** | §4.2 | Search | Search failure handling | Returns HTTP 502 with descriptive error if all upstream instances fail. Returns `{ tracks: [] }` if upstream returns empty items. |
| **REQ-STR-01** | §4.3 | Stream | Expose `GET /stream/:id` endpoint | Accepts track ID in URL path and optional `quality` in query string (defaults to `LOSSLESS`). |
| **REQ-STR-02** | §4.3, §7.5 | Stream | Upstream stream resolution | Queries upstream via `GET /track/?id={id}&quality={quality}` using active instance pool with failover. |
| **REQ-STR-03** | §6, §7.5 | Stream | In-loop 29-second preview failover | `fetchFromPool` validator checks `assetPresentation !== "PREVIEW"` and `!(duration && duration <= 30)`. If triggered, blacklists node for 300,000ms and fails over to next node in loop. |
| **REQ-STR-04** | §4.3, §7.5 | Stream | Base64 manifest decoding | Decodes `trackData.manifest` from Base64 into UTF-8 string; parses JSON BTS payload. |
| **REQ-STR-05** | §4.3, §7.5 | Stream | Direct FLAC stream payload (BTS) | When `manifestMimeType` includes `vnd.tidal.bts` or payload starts with `{`: extracts `urls[0]`, returns `format: "flac"`, `mimeType: "audio/flac"`, `manifest: "none"`, `encrypted: false`, sampleRate, bitDepth. |
| **REQ-STR-06** | §4.3, §7.5 | Stream | DASH XML fallback step-down | When upstream returns MPEG-DASH XML (`dash+xml` or `<MPD`), automatically re-requests track with `quality=LOSSLESS` to extract direct `https://...flac` stream URL, avoiding `ModuleSource.malformed()` rejection. |
| **REQ-STR-07** | §4.3 | Stream | Stream DRM & URL validation | Explicitly emits `encrypted: false` and guarantees `url` starts with `http://` or `https://` (passes `toHttpUrlOrNull()`). |
| **REQ-STR-08** | §4.3, §7.5 | Stream | Stream error propagation | Returns HTTP 502 with error details if all instances fail or manifest cannot be resolved to a direct FLAC stream. |
| **REQ-POL-01** | §3, §7.1 | Pool | Dynamic environment override | Parses comma-separated URLs from `HIFI_API_INSTANCES` env var as priority 1 instance list if defined. |
| **REQ-POL-02** | §3, §7.2 | Pool | Startup remote registry discovery | Fetches `instances.json` at startup; **appends** active nodes behind verified fallback nodes to prevent unverified node latency. |
| **REQ-POL-03** | §3, §7.1 | Pool | Live fallback instance pool | Verified priority 1 nodes: `https://wolf.qqdl.site`, `https://maus.qqdl.site`, `https://vogel.qqdl.site`, `https://hund.qqdl.site`, `https://katze.qqdl.site`, `https://tidal.kinoplus.online`. |
| **REQ-POL-04** | §1 C3-C4 | Pool | Dead domain blacklisting | Explicitly prohibits and excludes dead domains (`*.monochrome.tf`, `*.spotisaver.net`). |
| **REQ-POL-05** | §2.1, §7.2 | Pool | Health tracking & cooldown | Maintains in-memory blacklist: 300,000ms for preview/auth errors; 180,000ms for HTTP/timeout errors. Auto-unblocks upon expiration. |
| **REQ-POL-06** | §2.1, §7.3 | Pool | Request timeout enforcement | Enforces a strict 5,000ms timeout per upstream fetch request using `AbortSignal.timeout(5000)`. |
| **REQ-POL-07** | §5, §7.3 | Pool | Upstream request headers | Sends standard headers: `User-Agent`, `x-client: BiniLossless/v3.4`, `Origin: https://monochrome.st`, `Referer: https://monochrome.st/`. |
| **REQ-OPS-01** | §7.1 | Operational | Configurable host and port | Reads `HOST` (default `0.0.0.0`) and `PORT` (default `8080`) from process environment. |
| **REQ-OPS-02** | §4.2 | Operational | CORS configuration | Enables CORS across all origins (`origin: true`) to support web client wrappers and cross-origin probes. |
| **REQ-OPS-03** | §7.0 | Operational | TypeScript ESM NodeNext structure | Enforces strict `.js` import specifiers on all local relative imports. |
| **REQ-GIT-01** | DevOps | Git & Licensing | Open-source licensing & hygiene | Root repository contains `LICENSE` (MIT License), standard `.gitignore`, and `.nvmrc` pinning Node version >= 20. |
| **REQ-GIT-02** | DevOps | CI/CD | GitHub Actions multi-version CI | `.github/workflows/ci.yml` matrix-tests against Node.js 20.x, 22.x, and 24.x, executing `npm ci`, type-check (`tsc --noEmit`), and test suite (`npm test`). |
| **REQ-GIT-03** | DevOps | CI/CD | GHCR Docker image automation | `.github/workflows/docker.yml` builds and publishes multi-arch container images to GitHub Container Registry (`ghcr.io`) on releases and pushes to `main`. |
| **REQ-GIT-04** | DevOps | Releases | Semantic release & changelog | `.github/workflows/release.yml` automatically drafts GitHub releases with release assets and changelogs on version tags. |
| **REQ-GIT-05** | DevOps | Community | Issue & PR templates | `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml`, and `PULL_REQUEST_TEMPLATE.md` standardized for community issue reporting. |
| **REQ-GIT-06** | DevOps | Security | Dependabot dependency updates | `.github/dependabot.yml` configured for weekly security updates on npm dependencies and GitHub Actions workflows. |
| **REQ-GIT-07** | DevOps | Deployment | One-click cloud deploy templates | Repository includes `render.yaml` (Render Blueprint) and `railway.json` for zero-configuration 1-click cloud hosting. |
| **REQ-GIT-08** | DevOps | Deployment | Multi-stage Dockerfile hygiene | Dockerfile copies both `package.json` and `package-lock.json` (`COPY package*.json ./`) in Stage 2 before running `npm ci --omit=dev`. |
| **REQ-GIT-09** | DevOps | Documentation | Comprehensive repository README | `README.md` includes project badges, BitChord step-by-step setup guide, 1-click deploy buttons, environment variable reference, and API documentation. |

---

## 3. Existing-System Analysis and Identified Gaps

### Repository State Analysis (`F:\bitchord\provider`)
- **Current Artifacts**:
  - `Monochrome BitChord Add-on Technical Plan.md`: Original conceptual document (contains 5 identified fatal flaws).
  - `Monochrome Provider Validated Spec Plan.md`: Authoritative validated specification document.
  - `Monochrome Provider Implementation Plan.md`: Implementation plan baseline.
  - `temp_bitchord/`: Reference clone of BitChord client source code (verified `AddonSource.kt:322`, `ModuleSource.kt:460-472` malformed URL check, `AddonModels.kt:141-170` AddonTrack schema).
  - `temp_octo/`: Reference clone of Octo-Fiesta (verified upstream header and fallback behavior).
- **Gaps Addressed in v1.2.0**:
  1. **Preview Failover Gap**: `fetchFromPool` previously had no response validation hook. Upstream HTTP 200 responses with `assetPresentation: "PREVIEW"` bypassed failover and threw an unrecoverable 502 in `stream.ts`. Addressed by adding `validate` callback into `fetchFromPool`.
  2. **DASH Data URI Playback Gap**: `data:application/dash+xml` was specified, but BitChord's `AddonSource.kt:322` runs URLs through `ModuleSource.malformed(url)`, where `url.toHttpUrlOrNull()` rejects non-HTTP schemes as malformed. Addressed by automatic step-down to `quality=LOSSLESS` for direct FLAC URLs.
  3. **Docker Multi-Stage Build Gap**: Stage 2 was missing `package-lock.json`, causing `npm ci --omit=dev` to fail with `ENOENT`. Addressed with `COPY package*.json ./`.
  4. **TypeScript ESM NodeNext Gap**: TypeScript `NodeNext` requires explicit `.js` extensions on imports. Addressed across all task instructions.
  5. **Discovery Latency Gap**: Prepending untested dynamic instances introduced 5-15s startup timeouts. Addressed by appending dynamic nodes behind verified nodes.

---

## 4. Architecture and Implementation Approach

### Operational Architecture & In-Loop Validation Flow

```
                     ┌───────────────────────────────────────────────┐
                     │          BitChord Client (v1.5.2+)            │
                     └───────────────────────┬───────────────────────┘
                                             │ HTTP REST
                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Fastify Server (src/index.ts)                                                      │
│  - CORS Middleware (@fastify/cors)                                                 │
│  - Configuration & Env (src/config.js)                                             │
├────────────────────────┬───────────────────────────┬───────────────────────────────┤
│ GET /manifest.json     │ GET /search               │ GET /stream/:id               │
│ (src/routes/manifest)  │ (src/routes/search)       │ (src/routes/stream)           │
└───────────┬────────────┴─────────────┬─────────────┴───────────────┬───────────────┘
            │                          │                             │
            │                          ▼                             ▼
            │               ┌────────────────────┐        ┌────────────────────┐
            │               │ src/transforms/    │        │ src/transforms/    │
            │               │  - trackMapper.js  │        │  - manifestDecoder │
            │               │  - coverUrl.js     │        └──────────┬─────────┘
            │               └──────────┬─────────┘                   │
            │                          │                             │
            ▼                          ▼                             ▼
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Failover & Pooling Layer (src/pool/)                                               │
│  - InstancePool (instancePool.js): Health tracker, appended discovery, blacklist   │
│  - fetchFromPool (fetchFromPool.js):                                               │
│      * 5s AbortSignal timeout                                                      │
│      * In-Loop Response Validator (Catches HTTP 200 Preview Clips)                 │
│      * Auto-blacklists node and iterates to NEXT candidate                         │
└──────────────────────────────────────┬─────────────────────────────────────────────┘
                                       │ HTTPS Fetch (Failover)
                                       ▼
                     ┌───────────────────────────────────────────────┐
                     │ Live Upstream HiFi API Instance Pool          │
                     │ [1. wolf, 2. maus, 3. vogel, 4. hund, ...]    │
                     └───────────────────────────────────────────────┘
```

---

## 5. Ordered Implementation Phases and Tasks

### Phase 1: Environment & Project Scaffolding
**Objective:** Initialize a clean TypeScript Node.js project matching target structure with ESM NodeNext compliance and git hygiene.

#### Task 1.1: Project Configuration & Package Initialization
- **Linked Requirements:** REQ-OPS-03
- **Files Affected:** `package.json`, `tsconfig.json`, `.gitignore`
- **Implementation Instructions:**
  1. Create `package.json` with `"type": "module"`, `"engines": { "node": ">=20.0.0" }`, and scripts:
     - `"build": "tsc"`
     - `"start": "node dist/index.js"`
     - `"dev": "tsx watch src/index.ts"`
     - `"test": "tsx --test tests/**/*.test.ts"`
     - `"test:live": "tsx tests/liveIntegration.test.ts"`
     - `"typecheck": "tsc --noEmit"`
  2. Declare dependencies: `fastify` (^4.26.0), `@fastify/cors` (^9.0.0).
  3. Declare devDependencies: `typescript` (^5.3.3), `tsx` (^4.7.0), `@types/node` (^20.11.0).
  4. Create `tsconfig.json`:
     ```json
     {
       "compilerOptions": {
         "target": "ES2022",
         "module": "NodeNext",
         "moduleResolution": "NodeNext",
         "outDir": "./dist",
         "rootDir": "./src",
         "strict": true,
         "esModuleInterop": true,
         "skipLibCheck": true,
         "forceConsistentCasingInFileNames": true
       },
       "include": ["src/**/*"]
     }
     ```
     *Enforce Rule: All internal imports must use explicit `.js` extensions (e.g., `from './config.js'`).*
  5. Create `.gitignore` ignoring `node_modules/`, `dist/`, `.env`, `temp_bitchord/`, `temp_octo/`, `*.log`, and OS artifacts.
- **Dependencies:** None.
- **Acceptance Criteria:** `npm install` installs dependencies; `npm run build` compiles with zero errors.
- **Verification Command:** `npm install && npm run build`

#### Task 1.2: Git Repository Initialization & Licensing Hygiene
- **Linked Requirements:** REQ-GIT-01
- **Files Affected:** `.git/`, `LICENSE`, `.nvmrc`
- **Implementation Instructions:**
  1. Initialize local git repository: `git init -b main`.
  2. Create `LICENSE` with standard MIT License text.
  3. Create `.nvmrc` with content `20`.
- **Dependencies:** Task 1.1.
- **Acceptance Criteria:** Clean git tracking; `.nvmrc` set to 20; MIT license present.
- **Verification Command:** `git status`

---

### Phase 2: Configuration & Transform Utilities
**Objective:** Build configuration constants, instance registries, and pure transform functions for artwork formatting, track mapping, and manifest decoding.

#### Task 2.1: Configuration Module (`src/config.ts`)
- **Linked Requirements:** REQ-OPS-01, REQ-POL-01, REQ-POL-02, REQ-POL-03, REQ-POL-04, REQ-POL-06, REQ-POL-07
- **Files Affected:** `src/config.ts`
- **Implementation Instructions:**
  1. Export `PORT` (`process.env.PORT || 8080`) and `HOST` (`process.env.HOST || '0.0.0.0'`).
  2. Export `DEFAULT_INSTANCES` array (verified live nodes at Priority 1):
     ```typescript
     export const DEFAULT_INSTANCES = [
       'https://wolf.qqdl.site',
       'https://maus.qqdl.site',
       'https://vogel.qqdl.site',
       'https://hund.qqdl.site',
       'https://katze.qqdl.site',
       'https://tidal.kinoplus.online'
     ];
     ```
  3. Export `UPSTREAM_TIMEOUT_MS = 5000`.
  4. Export `BLACKLIST_PREVIEW_COOLDOWN_MS = 300000` (5 minutes).
  5. Export `BLACKLIST_ERROR_COOLDOWN_MS = 180000` (3 minutes).
  6. Export `DISCOVERY_REGISTRY_URL = 'https://raw.githubusercontent.com/monochrome-music/monochrome/main/public/instances.json'`.
  7. Export `UPSTREAM_HEADERS`:
     ```typescript
     export const UPSTREAM_HEADERS = {
       'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
       'x-client': 'BiniLossless/v3.4',
       'Origin': 'https://monochrome.st',
       'Referer': 'https://monochrome.st/'
     };
     ```
- **Dependencies:** Task 1.1.
- **Acceptance Criteria:** Exports all configuration constants with strict types.
- **Verification Command:** `tsx -e "import * as c from './src/config.js'; console.log(c.DEFAULT_INSTANCES.length);"`

#### Task 2.2: Artwork URL & Track Transforms (`src/transforms/coverUrl.ts`, `src/transforms/trackMapper.ts`)
- **Linked Requirements:** REQ-SCH-04, REQ-SCH-05, REQ-SCH-06, REQ-SCH-07
- **Files Affected:** `src/transforms/coverUrl.ts`, `src/transforms/trackMapper.ts`
- **Implementation Instructions:**
  1. `formatCoverUrl(coverUuid?: string): string | null`: Replaces hyphens with slashes and returns `https://resources.tidal.com/images/{path}/640x640.jpg`.
  2. `mapHiFiTrackToAddon(item: any): any`:
     - `id`: `String(item.id)`
     - `title`: `item.title`
     - `artist`: `item.artist?.name || item.artists?.[0]?.name || 'Unknown Artist'`
     - `album`: `item.album?.title || ''`
     - `duration`: `Number(item.duration || 0)` — **CRITICAL: Store as seconds directly (`Double`). Never multiply by 1000.**
     - `artworkURL`: `formatCoverUrl(item.album?.cover)`
     - `format`: `'flac'`
     - `audioQuality`: `item.mediaMetadata?.tags?.includes('HIRES_LOSSLESS') ? 'HI_RES_LOSSLESS' : 'LOSSLESS'`
     - `isrc`: `item.isrc || null` (passed through as informational extra)
- **Dependencies:** Task 1.1.
- **Acceptance Criteria:** Duration is strictly in seconds; cover URL correctly formatted.
- **Verification Command:** Run unit test `tests/transforms.test.ts`.

#### Task 2.3: Manifest Decoder Module (`src/transforms/manifestDecoder.ts`)
- **Linked Requirements:** REQ-STR-04, REQ-STR-05, REQ-STR-06, REQ-STR-07
- **Files Affected:** `src/transforms/manifestDecoder.ts`
- **Implementation Instructions:**
  1. Implement `decodeStreamManifest(rawManifestBase64: string, manifestMimeType: string, quality?: string)`:
  2. Decode Base64 string via `Buffer.from(rawManifestBase64, 'base64').toString('utf-8')`.
  3. **Direct FLAC Handling (BTS)**:
     If `manifestMimeType.includes('vnd.tidal.bts')` or decoded string trimmed begins with `{`:
     - Parse JSON.
     - Extract `urls[0]`.
     - Validate `urls[0]` starts with `http://` or `https://` (conforming to `toHttpUrlOrNull()`).
     - Return:
       ```typescript
       {
         url: manifestJson.urls[0],
         format: 'flac',
         quality: quality || 'LOSSLESS',
         mimeType: 'audio/flac',
         manifest: 'none',
         encrypted: false,
         sampleRate: manifestJson.sampleRate || 44100,
         bitDepth: manifestJson.bitDepth || 16,
         headers: { 'User-Agent': UPSTREAM_HEADERS['User-Agent'] }
       }
       ```
  4. **MPEG-DASH Detection**:
     If `manifestMimeType.includes('dash+xml')` or decoded string trimmed begins with `<MPD`:
     - Return `{ isDash: true }` signaling the route handler to execute an automatic step-down query with `quality=LOSSLESS`.
     - *Design Rationale: Never return `data:application/dash+xml` because BitChord's `AddonSource.kt:322` runs `ModuleSource.malformed(url)`, where `toHttpUrlOrNull()` drops non-HTTP schemes as malformed.*
- **Dependencies:** Task 2.1.
- **Acceptance Criteria:** Decodes BTS manifest to direct FLAC URL with `encrypted: false`; flags DASH XML for step-down.
- **Verification Command:** Run unit test `tests/manifestDecoder.test.ts`.

---

### Phase 3: Instance Pool & Upstream Failover Client
**Objective:** Build the failover network engine with in-loop preview validation, timeout management, and healthy candidate sequencing.

#### Task 3.1: Instance Pool Manager (`src/pool/instancePool.ts`)
- **Linked Requirements:** REQ-POL-01, REQ-POL-02, REQ-POL-03, REQ-POL-04, REQ-POL-05
- **Files Affected:** `src/pool/instancePool.ts`
- **Implementation Instructions:**
  1. Implement `InstancePool` class:
     - `instances: string[]`
     - `blacklist: Map<string, number>` (URL -> unblock timestamp)
  2. `constructor()` sets `instances = [...DEFAULT_INSTANCES]` (or env override if present).
  3. `initDynamicDiscovery()`:
     - Asynchronously fetches `DISCOVERY_REGISTRY_URL` with 4s timeout.
     - Extracts `data.api` array.
     - Filters out `*.monochrome.tf`, dead, or malformed domains.
     - **APPENDS** discovered instances to the end of `instances` (e.g. `this.instances = [...this.instances, ...newInstances]`), ensuring verified nodes remain Priority 1.
  4. `getActiveInstances()`: Returns instances not currently in blacklist (auto-cleans expired entries).
  5. `markUnhealthy(url: string, durationMs: number)`: Enters timestamp in blacklist.
- **Dependencies:** Task 2.1.
- **Acceptance Criteria:** Verified nodes are tried first; blacklisting temporarily excludes failing nodes; discovery appends rather than prepends.
- **Verification Command:** Run unit test `tests/instancePool.test.ts`.

#### Task 3.2: Upstream Fetch Client with In-Loop Validation & Failover (`src/pool/fetchFromPool.ts`)
- **Linked Requirements:** REQ-POL-05, REQ-POL-06, REQ-POL-07, REQ-SCH-03, REQ-STR-02, REQ-STR-03
- **Files Affected:** `src/pool/fetchFromPool.ts`
- **Implementation Instructions:**
  1. Define response validator signature:
     ```typescript
     export type ResponseValidator = (data: any, response: Response) => { valid: boolean; reason?: string; isPreview?: boolean };
     ```
  2. Implement `fetchFromPool(pool: InstancePool, pathAndQuery: string, options: RequestInit = {}, validator?: ResponseValidator): Promise<{ data: any; instance: string }>`:
  3. Retrieve `candidates = pool.getActiveInstances()`. If length is 0, throw error `"All upstream instances are currently blacklisted or unavailable"`.
  4. Loop sequentially through candidates:
     - Sanitize URL: `cleanBase = candidate.replace(/\/+$/, '')`.
     - Target URL: `${cleanBase}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`.
     - Execute fetch with `AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)` and `UPSTREAM_HEADERS`.
     - If response status is not 2xx, throw error `HTTP ${response.status}: ${response.statusText}`.
     - Parse JSON `json = await response.json()`.
     - **In-Loop Response Validation**:
       If `validator` is supplied:
       ```typescript
       const validation = validator(json, response);
       if (!validation.valid) {
         const cooldown = validation.isPreview ? BLACKLIST_PREVIEW_COOLDOWN_MS : BLACKLIST_ERROR_COOLDOWN_MS;
         pool.markUnhealthy(cleanBase, cooldown);
         console.warn(`[Failover] Node ${cleanBase} rejected by validator (${validation.reason}). Failing over to next node...`);
         lastError = new Error(validation.reason);
         continue; // Tries the NEXT candidate in the pool!
       }
       ```
     - Return `{ data: json, instance: cleanBase }`.
  5. Catch block:
     - Mark instance unhealthy for `BLACKLIST_ERROR_COOLDOWN_MS` (180,000ms).
     - Log warning and continue loop.
  6. If all candidates fail, throw aggregated error with details of last error.
- **Dependencies:** Tasks 2.1, 3.1.
- **Acceptance Criteria:** Automatically retries next node when validator flags an HTTP 200 preview clip; retries next node on HTTP errors and timeouts.
- **Verification Command:** Run unit test `tests/fetchFromPool.test.ts`.

---

### Phase 4: Core HTTP Route Handlers
**Objective:** Implement the three specified BitChord protocol endpoints with rigorous schema adherence and automatic DASH-to-FLAC step-down.

#### Task 4.1: Add-on Manifest Route (`src/routes/manifest.ts`)
- **Linked Requirements:** REQ-MAN-01, REQ-MAN-02, REQ-MAN-03, REQ-MAN-04
- **Files Affected:** `src/routes/manifest.ts`
- **Implementation Instructions:**
  1. Fastify plugin exporting `manifestRoutes`.
  2. Handler for `GET /manifest.json`:
     ```typescript
     return {
       id: "com.bitchord.addon.monochrome",
       name: "Monochrome Lossless Provider",
       version: "1.0.0",
       description: "Lossless FLAC & Hi-Res audio provider backed by Monochrome HiFi API network.",
       author: "BitChord Community",
       icon: "https://monochrome.st/favicon.ico",
       resources: ["search", "stream", "settings"],
       types: ["track"],
       contentType: "music",
       settings: [
         {
           key: "audio_quality",
           title: "Preferred Audio Quality",
           type: "select",
           default: "LOSSLESS",
           options: [
             { label: "Hi-Res Lossless (24-bit / 192kHz)", value: "HI_RES_LOSSLESS" },
             { label: "Lossless FLAC (16-bit / 44.1kHz)", value: "LOSSLESS" },
             { label: "High (320kbps AAC)", value: "HIGH" }
           ]
         }
       ]
     };
     ```
- **Dependencies:** Task 1.1.
- **Acceptance Criteria:** Returns HTTP 200 with schema matching BitChord `AddonModels.kt`.
- **Verification Command:** Fastify injection test in `tests/manifest.test.ts`.

#### Task 4.2: Track Search Route (`src/routes/search.ts`)
- **Linked Requirements:** REQ-SCH-01, REQ-SCH-02, REQ-SCH-03, REQ-SCH-04, REQ-SCH-05, REQ-SCH-06, REQ-SCH-07, REQ-SCH-08
- **Files Affected:** `src/routes/search.ts`
- **Implementation Instructions:**
  1. Fastify plugin exporting `searchRoutes(pool: InstancePool)`.
  2. Handler for `GET /search`:
     - Query: `q?: string`, `quality?: string`.
     - If `!q || !q.trim()`: return 400 with `{ error: 'Query parameter "q" is required.' }`.
     - Call `fetchFromPool(pool, `/search/?s=${encodeURIComponent(q.trim())}`)`.
     - Extract `items = data?.data?.items || data?.items || []`.
     - Map with `mapHiFiTrackToAddon(item)`.
     - Return `{ tracks }`.
  3. If all upstream instances fail, return HTTP 502 with `{ error: "Upstream search failed", details: err.message }`.
- **Dependencies:** Tasks 2.2, 3.2.
- **Acceptance Criteria:** Returns 400 on empty query; returns mapped tracks with duration in seconds.
- **Verification Command:** Fastify injection test in `tests/search.test.ts`.

#### Task 4.3: Stream Resolution Route with DASH Fallback (`src/routes/stream.ts`)
- **Linked Requirements:** REQ-STR-01, REQ-STR-02, REQ-STR-03, REQ-STR-04, REQ-STR-05, REQ-STR-06, REQ-STR-07, REQ-STR-08
- **Files Affected:** `src/routes/stream.ts`
- **Implementation Instructions:**
  1. Fastify plugin exporting `streamRoutes(pool: InstancePool)`.
  2. Define stream preview validator:
     ```typescript
     const streamValidator: ResponseValidator = (json) => {
       const trackData = json?.data || json;
       if (!trackData || !trackData.manifest) {
         return { valid: false, reason: 'Missing manifest payload' };
       }
       if (trackData.assetPresentation === 'PREVIEW' || (trackData.duration && trackData.duration <= 30)) {
         return { valid: false, reason: 'Preview clip detected (token expired)', isPreview: true };
       }
       return { valid: true };
     };
     ```
  3. Handler for `GET /stream/:id`:
     - Params: `id: string`. Query: `quality?: string`.
     - Request upstream via `fetchFromPool(pool, `/track/?id=${id}&quality=${quality || 'LOSSLESS'}`, {}, streamValidator)`.
     - Extract `trackData = data?.data || data`.
     - Call `decodeStreamManifest(trackData.manifest, trackData.manifestMimeType || '', quality)`.
     - **DASH-to-FLAC Step-Down Handler**:
       If decoded result indicates `{ isDash: true }`:
       - Log: `"[Stream] Hi-Res DASH XML returned; stepping down to LOSSLESS FLAC for BitChord compatibility."`.
       - Query upstream again with `quality=LOSSLESS`:
         `const fallback = await fetchFromPool(pool, `/track/?id=${id}&quality=LOSSLESS`, {}, streamValidator)`.
       - Decode fallback manifest (BTS direct FLAC).
       - Return direct FLAC stream payload.
     - Otherwise, return decoded direct FLAC payload (`url`, `format: "flac"`, `manifest: "none"`, `encrypted: false`, sampleRate, bitDepth).
  4. Catch errors: Return HTTP 502 with `{ error: "Stream extraction failed", details: err.message }`.
- **Dependencies:** Tasks 2.3, 3.2.
- **Acceptance Criteria:** In-loop preview failover catches expired tokens; DASH streams cleanly step down to direct FLAC URLs; returns `encrypted: false`.
- **Verification Command:** Fastify injection test in `tests/stream.test.ts`.

---

### Phase 5: Server Assembly & Operational Wiring
**Objective:** Assemble Fastify server with CORS, routing, and graceful shutdown.

#### Task 5.1: Main Server Entrypoint (`src/index.ts`)
- **Linked Requirements:** REQ-OPS-01, REQ-OPS-02, REQ-OPS-03
- **Files Affected:** `src/index.ts`
- **Implementation Instructions:**
  1. Instantiate Fastify with structured logger.
  2. Register `@fastify/cors` with `{ origin: true }`.
  3. Instantiate `InstancePool` and trigger `pool.initDynamicDiscovery()` in background.
  4. Register plugins: `manifestRoutes`, `searchRoutes`, `streamRoutes`.
  5. Bind to `PORT` and `HOST`.
  6. Setup `SIGINT`/`SIGTERM` graceful shutdown listeners.
- **Dependencies:** Tasks 4.1, 4.2, 4.3.
- **Acceptance Criteria:** Server boots on configured port; responds to all routes.
- **Verification Command:** `npm run dev` and test probe `curl http://localhost:8080/manifest.json`.

---

### Phase 6: Automated Testing & Verification Gates
**Objective:** Comprehensive unit and integration test suite verifying in-loop failover, duration units, and DASH step-down.

#### Task 6.1: Unit Tests for Transforms & Decoder (`tests/transforms.test.ts`, `tests/manifestDecoder.test.ts`)
- **Linked Requirements:** REQ-SCH-05, REQ-SCH-06, REQ-STR-04, REQ-STR-05, REQ-STR-06, REQ-STR-07
- **Files Affected:** `tests/transforms.test.ts`, `tests/manifestDecoder.test.ts`
- **Implementation Instructions:**
  1. Test `formatCoverUrl`: Test UUID with hyphens, undefined, null.
  2. Test `mapHiFiTrackToAddon`: Assert duration is in seconds (`266.0`, not `266000`).
  3. Test `decodeStreamManifest`:
     - Test Base64 BTS manifest -> produces direct FLAC URL, `encrypted: false`, sampleRate 44100, bitDepth 16.
     - Test Base64 DASH XML -> flags `{ isDash: true }`.
- **Dependencies:** Tasks 2.2, 2.3.
- **Acceptance Criteria:** 100% test pass rate.
- **Verification Command:** `tsx --test tests/transforms.test.ts tests/manifestDecoder.test.ts`

#### Task 6.2: Instance Pool & In-Loop Failover Tests (`tests/instancePool.test.ts`, `tests/fetchFromPool.test.ts`)
- **Linked Requirements:** REQ-POL-04, REQ-POL-05, REQ-POL-06, REQ-STR-03
- **Files Affected:** `tests/instancePool.test.ts`, `tests/fetchFromPool.test.ts`
- **Implementation Instructions:**
  1. Test pool sequencing: Assert verified nodes are first; dynamic discovery nodes are appended.
  2. Test in-loop preview failover: Mock Candidate 1 returning HTTP 200 with `assetPresentation: "PREVIEW"` and Candidate 2 returning `assetPresentation: "FULL"`. Assert `fetchFromPool` automatically returns Candidate 2 and Candidate 1 is blacklisted.
  3. Test HTTP 500 / timeout failover across pool candidates.
- **Dependencies:** Tasks 3.1, 3.2.
- **Acceptance Criteria:** In-loop failover passes; preview node is blacklisted without terminating the request.
- **Verification Command:** `tsx --test tests/instancePool.test.ts tests/fetchFromPool.test.ts`

#### Task 6.3: HTTP Route Integration Tests (`tests/routes.test.ts`)
- **Linked Requirements:** REQ-MAN-01, REQ-MAN-02, REQ-MAN-03, REQ-SCH-01, REQ-SCH-02, REQ-STR-01, REQ-STR-06
- **Files Affected:** `tests/routes.test.ts`
- **Implementation Instructions:**
  1. Fastify `.inject()` verification of `GET /manifest.json`.
  2. Fastify `.inject()` verification of `GET /search` (empty query -> 400).
  3. Fastify `.inject()` verification of `GET /stream/:id` with mocked DASH upstream -> verifies step-down to direct FLAC BTS stream.
- **Dependencies:** Task 5.1.
- **Acceptance Criteria:** All Fastify inject tests pass.
- **Verification Command:** `tsx --test tests/routes.test.ts`

---

### Phase 7: Deployment Infrastructure & Live Acceptance
**Objective:** Provide containerization and live verification tools.

#### Task 7.1: Production Dockerfile & Container Packaging
- **Linked Requirements:** REQ-OPS-01, REQ-OPS-03, REQ-GIT-08
- **Files Affected:** `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- **Implementation Instructions:**
  1. Multi-stage Dockerfile:
     - Stage 1 (Builder): `node:20-alpine` (`COPY package*.json ./`, `npm ci`, `COPY . .`, `npm run build`).
     - Stage 2 (Runner): `node:20-alpine` (`NODE_ENV=production`, **`COPY package*.json ./`** — *crucial for npm ci!*, `npm ci --omit=dev`, `COPY --from=builder /app/dist ./dist`).
     - Expose port `8080`.
     - Healthcheck: `CMD wget --no-verbose --tries=1 --spider http://localhost:8080/manifest.json || exit 1`.
  2. `docker-compose.yml` service definition.
  3. `.dockerignore` ignoring `node_modules`, `dist`, `.git`, `.env`, and tests.
- **Dependencies:** Task 5.1.
- **Acceptance Criteria:** Container builds cleanly without npm ci lockfile errors; healthcheck passes.
- **Verification Command:** `docker build -t bitchord-monochrome-addon .`

#### Task 7.2: Live Upstream Integration Gate
- **Linked Requirements:** REQ-SCH-03, REQ-STR-02, REQ-POL-03
- **Files Affected:** `tests/liveIntegration.test.ts`
- **Implementation Instructions:**
  1. Live integration test connecting to live `wolf.qqdl.site`:
     - Queries search for `Yellow Coldplay`.
     - Confirms `items[0].id` is resolved.
     - Resolves stream for track ID.
     - Confirms direct FLAC URL is returned and responds to HTTP HEAD probe.
- **Dependencies:** Task 5.1.
- **Acceptance Criteria:** Live stream URL is resolved and confirmed playable.
- **Verification Command:** `tsx tests/liveIntegration.test.ts`

---

### Phase 8: GitHub Repository Lifecycle, Automation & Community Standards
**Objective:** Open-source repository infrastructure, CI/CD automation, cloud deployment blueprints, and community issue workflows.

#### Task 8.1: GitHub Actions Multi-Version CI Workflow (`.github/workflows/ci.yml`)
- **Linked Requirements:** REQ-GIT-02
- **Files Affected:** `.github/workflows/ci.yml`
- **Implementation Instructions:**
  1. Trigger on `push: [main]` and `pull_request: [main]`.
  2. Matrix test across Node.js versions: `[20.x, 22.x, 24.x]`.
  3. Steps: `actions/checkout@v4`, `actions/setup-node@v4` with npm cache, `npm ci`, `npm run typecheck` (`tsc --noEmit`), `npm test`, `npm run build`.
- **Dependencies:** Tasks 1.1, 6.1, 6.2, 6.3.
- **Acceptance Criteria:** CI matrix passes across Node 20, 22, and 24.
- **Verification Command:** Local lint / workflow check.

#### Task 8.2: Automated Container Publishing to GHCR (`.github/workflows/docker.yml`)
- **Linked Requirements:** REQ-GIT-03
- **Files Affected:** `.github/workflows/docker.yml`
- **Implementation Instructions:**
  1. Trigger on `release: [published]` or manual dispatch.
  2. Multi-arch build (`linux/amd64`, `linux/arm64`) with Buildx.
  3. Push to `ghcr.io/${{ github.repository }}:${{ github.ref_name }}` and `latest`.
- **Dependencies:** Tasks 7.1, 8.1.
- **Acceptance Criteria:** Builds multi-arch container and publishes to GHCR.

#### Task 8.3: Release Automation & Security Dependabot (`.github/workflows/release.yml`, `.github/dependabot.yml`)
- **Linked Requirements:** REQ-GIT-04, REQ-GIT-06
- **Files Affected:** `.github/workflows/release.yml`, `.github/dependabot.yml`
- **Implementation Instructions:**
  1. `.github/dependabot.yml` monitoring npm and github-actions weekly.
  2. `.github/workflows/release.yml` generating changelogs and attaching `dist/` tarballs on version tags (`v*.*.*`).
- **Dependencies:** Task 8.1.
- **Acceptance Criteria:** Dependabot configured; release action triggers on version tags.

#### Task 8.4: Community Issue & Pull Request Templates (`.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`)
- **Linked Requirements:** REQ-GIT-05
- **Files Affected:** `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml`, `PULL_REQUEST_TEMPLATE.md`
- **Implementation Instructions:**
  1. `bug_report.yml` capturing BitChord client version (v1.5.2+), host platform, failing song/ISRC.
  2. `feature_request.yml` for enhancement proposals.
  3. `PULL_REQUEST_TEMPLATE.md` checklist.
- **Dependencies:** None.

#### Task 8.5: Cloud 1-Click Blueprints & Complete Repository README (`render.yaml`, `railway.json`, `README.md`)
- **Linked Requirements:** REQ-GIT-07, REQ-GIT-09
- **Files Affected:** `render.yaml`, `railway.json`, `README.md`
- **Implementation Instructions:**
  1. `render.yaml` free web service blueprint.
  2. `railway.json` Docker deployment schema.
  3. `README.md` with badges, 1-click deploy buttons, BitChord step-by-step setup guide, and environment variable table.
- **Dependencies:** Tasks 7.1, 8.1, 8.5.

#### Task 8.6: Git Repository Initialization & Push Walkthrough
- **Linked Requirements:** REQ-GIT-01
- **Files Affected:** Git repository remote configuration
- **Implementation Instructions:**
  1. Local commit: `git add . && git commit -m "feat: validated monochrome bitchord addon v1.2"`.
  2. Remote setup: `gh repo create bitchord-monochrome-addon --public --source=. --remote=origin --push`.
  3. Branch protection on `main`.
- **Dependencies:** Tasks 8.1 through 8.5.

---

## 6. Requirement-to-Task Traceability Matrix

| Requirement ID | Spec Section | Primary Implementation Task(s) | Verification Task | Verification Method | Status |
|---|---|---|---|---|---|
| **REQ-MAN-01** | §4.1 | Task 4.1 | Task 6.3 | Fastify inject `GET /manifest.json` | Pending Execution |
| **REQ-MAN-02** | §4.1 | Task 4.1 | Task 6.3 | Schema assertion on manifest payload | Pending Execution |
| **REQ-MAN-03** | §4.1 | Task 4.1 | Task 6.3 | Assert `resources` contains only `["search", "stream", "settings"]` | Pending Execution |
| **REQ-MAN-04** | §4.1 | Task 4.1 | Task 6.3 | Assert `settings` has `audio_quality` | Pending Execution |
| **REQ-SCH-01** | §4.2 | Task 4.2 | Task 6.3 | Fastify inject `GET /search?q=test` | Pending Execution |
| **REQ-SCH-02** | §4.2 | Task 4.2 | Task 6.3 | Fastify inject `GET /search` returns 400 | Pending Execution |
| **REQ-SCH-03** | §4.2 | Task 3.2, Task 4.2 | Task 6.2, Task 7.2 | Failover fetch test & live test | Pending Execution |
| **REQ-SCH-04** | §4.2 | Task 2.2, Task 4.2 | Task 6.1 | Transform assertion on track properties | Pending Execution |
| **REQ-SCH-05** | §4.2 | Task 2.2 | Task 6.1 | Assert duration is in seconds (`266.0`) | Pending Execution |
| **REQ-SCH-06** | §4.2 | Task 2.2 | Task 6.1 | Assert UUID slashes substitution | Pending Execution |
| **REQ-SCH-07** | §4.2 | Task 2.2, Task 4.2 | Task 6.1 | Assert ISRC passthrough as extra | Pending Execution |
| **REQ-SCH-08** | §4.2 | Task 4.2 | Task 6.3 | Mock upstream failure -> HTTP 502 | Pending Execution |
| **REQ-STR-01** | §4.3 | Task 4.3 | Task 6.3 | Fastify inject `GET /stream/:id` | Pending Execution |
| **REQ-STR-02** | §4.3 | Task 3.2, Task 4.3 | Task 6.2, Task 7.2 | Upstream fetch & live test | Pending Execution |
| **REQ-STR-03** | §6 | Task 3.2, Task 4.3 | Task 6.2 | Assert in-loop preview triggers next candidate | Pending Execution |
| **REQ-STR-04** | §4.3 | Task 2.3 | Task 6.1 | Assert Base64 decoding to string | Pending Execution |
| **REQ-STR-05** | §4.3 | Task 2.3, Task 4.3 | Task 6.1 | Assert direct FLAC url and metadata | Pending Execution |
| **REQ-STR-06** | §4.3 | Task 2.3, Task 4.3 | Task 6.3 | Assert DASH steps down to direct FLAC URL | Pending Execution |
| **REQ-STR-07** | §4.3 | Task 2.3, Task 4.3 | Task 6.1 | Assert `encrypted: false` & `http(s)` URL | Pending Execution |
| **REQ-STR-08** | §4.3 | Task 4.3 | Task 6.3 | Mock stream failure -> HTTP 502 | Pending Execution |
| **REQ-POL-01** | §3 | Task 2.1, Task 3.1 | Task 6.2 | Test env override parsing | Pending Execution |
| **REQ-POL-02** | §3 | Task 3.1 | Task 6.2 | Mock discovery fetch & assertion that it appends | Pending Execution |
| **REQ-POL-03** | §3 | Task 2.1, Task 3.1 | Task 6.2 | Assert fallback pool URLs | Pending Execution |
| **REQ-POL-04** | §1 | Task 2.1, Task 3.1 | Task 6.2 | Assert dead domains excluded | Pending Execution |
| **REQ-POL-05** | §2.1 | Task 3.1 | Task 6.2 | Test 300s/180s expiry in pool | Pending Execution |
| **REQ-POL-06** | §2.1 | Task 3.2 | Task 6.2 | Test 5000ms AbortSignal timeout | Pending Execution |
| **REQ-POL-07** | §5 | Task 2.1, Task 3.2 | Task 6.2 | Assert outgoing headers | Pending Execution |
| **REQ-OPS-01** | §7.1 | Task 2.1, Task 5.1 | Task 6.3 | Verify custom port & host binding | Pending Execution |
| **REQ-OPS-02** | §4.2 | Task 5.1 | Task 6.3 | Check `Access-Control-Allow-Origin` | Pending Execution |
| **REQ-OPS-03** | §7.0 | Phase 1 to 5 | Task 1.1 | Project structure & `.js` extension check | Pending Execution |
| **REQ-GIT-01** | DevOps | Task 1.2 | Task 1.2 | Verify `.git`, `LICENSE`, `.nvmrc` | Pending Execution |
| **REQ-GIT-02** | DevOps | Task 8.1 | Task 8.1 | CI run on Node 20, 22, 24 | Pending Execution |
| **REQ-GIT-03** | DevOps | Task 8.2 | Task 8.2 | GHCR Docker publish workflow syntax | Pending Execution |
| **REQ-GIT-04** | DevOps | Task 8.3 | Task 8.3 | Release automation workflow syntax | Pending Execution |
| **REQ-GIT-05** | DevOps | Task 8.4 | Task 8.4 | Issue & PR templates presence | Pending Execution |
| **REQ-GIT-06** | DevOps | Task 8.3 | Task 8.3 | Dependabot config validation | Pending Execution |
| **REQ-GIT-07** | DevOps | Task 8.5 | Task 8.5 | Verify `render.yaml` & `railway.json` | Pending Execution |
| **REQ-GIT-08** | DevOps | Task 7.1 | Task 7.1 | Docker Stage 2 package-lock check | Pending Execution |
| **REQ-GIT-09** | DevOps | Task 8.5 | Task 8.5 | README with badges & setup guide | Pending Execution |

---

## 7. Definition of Done (DoD)

An implementation task or phase is marked **Complete** only when:
1. **Code Conformance**: Code implements strict schemas; imports use explicit `.js` extensions; stream URLs strictly use `http://` or `https://` schemes.
2. **In-Loop Failover Tested**: Unit test confirms that preview clips trigger automatic progression to the next pool candidate.
3. **Compilation**: TypeScript compiles cleanly with zero type errors (`npm run build`).
4. **Automated Verification**: All associated unit and integration tests pass cleanly (`npm test`).
5. **CI Matrix Pass**: GitHub Actions workflow passes across all configured Node.js versions (20, 22, 24).
6. **Container & Cloud Readiness**: Docker container builds cleanly using `COPY package*.json ./`; 1-click deploy blueprints (`render.yaml`, `railway.json`) are valid.
7. **Documentation & Hygiene**: `README.md`, `LICENSE`, Dependabot, and issue templates are complete.
