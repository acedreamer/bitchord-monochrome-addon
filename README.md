# Monochrome Lossless Provider Add-on for BitChord

[![CI](https://github.com/bitchord/bitchord-monochrome-addon/actions/workflows/ci.yml/badge.svg)](https://github.com/bitchord/bitchord-monochrome-addon/actions/workflows/ci.yml)
[![Docker](https://github.com/bitchord/bitchord-monochrome-addon/actions/workflows/docker.yml/badge.svg)](https://github.com/bitchord/bitchord-monochrome-addon/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-green.svg)](https://nodejs.org/)

A high-performance, stateless HTTP source provider add-on for [BitChord](https://github.com/bitchord) (v1.5.2+), translating BitChord client requests to the community Monochrome / HiFi API network to deliver bit-perfect lossless 16-bit/44.1kHz FLAC and Hi-Res audio streams.

---

## 🚀 1-Click Cloud Deploy

Deploy your own private instance in seconds with zero configuration:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)

---

## ⚡ Core Features & Architectural Guarantees

- **Strict 3-Endpoint BitChord Protocol**: Implements `GET /manifest.json`, `GET /search`, and `GET /stream/:id`. All candidate scoring and fuzzy/ISRC matching are delegated to BitChord's native client-side `TrackMatcher`.
- **In-Loop 29-Second Preview Failover**: Automatically detects expired upstream tokens (`assetPresentation === "PREVIEW"` or 30-second clips) inside the request loop, blacklists the offending node for 5 minutes, and retries the next candidate in the pool transparently.
- **Automatic DASH-to-FLAC Step-Down**: When an upstream query returns MPEG-DASH XML, the provider automatically steps down to query `quality=LOSSLESS` to extract direct, unencrypted `https://...flac` stream URLs on TIDAL's Swift CDN with `encrypted: false`, avoiding `toHttpUrlOrNull()` rejection in ExoPlayer.
- **Accurate Duration in Seconds**: Preserves track duration strictly in **seconds (floating point / double)** as required by BitChord's `AddonModels.kt`, preventing duration mismatch failures.
- **Appended Dynamic Discovery**: Discovers live HiFi API nodes from the Monochrome registry at startup and appends them behind verified Priority 1 nodes, preventing unverified node latency.
- **ESM NodeNext & Production Docker**: 100% TypeScript ESM compliance with strict `.js` imports and multi-stage Docker builds.

---

## 📱 BitChord Client Setup Guide

1. Deploy this add-on locally or to a cloud host (Render, Railway, VPS).
2. Open the **BitChord** app on Android or Desktop.
3. Navigate to **Settings** > **Source Modules** / **Add-ons**.
4. Tap **Add Custom Provider** (`+`).
5. Enter the base URL of your deployed add-on (e.g. `http://192.168.1.100:8080` or `https://your-app.onrender.com`).
6. BitChord will query `GET /manifest.json`, register **Monochrome Lossless Provider**, and display it as an active lossless source!

---

## 🔧 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Port for the Fastify HTTP server to listen on. |
| `HOST` | `0.0.0.0` | Host interface to bind. |
| `HIFI_API_INSTANCES` | *(Internal verified pool)* | Comma-separated list of HiFi API node URLs (takes Priority 1). |

---

## 📡 API Specification

### 1. `GET /manifest.json`
Returns add-on metadata and configuration declaration for BitChord discovery.
```json
{
  "id": "com.bitchord.addon.monochrome",
  "name": "Monochrome Lossless Provider",
  "version": "1.0.0",
  "description": "Lossless FLAC & Hi-Res audio provider backed by Monochrome HiFi API network.",
  "author": "BitChord Community",
  "icon": "https://monochrome.st/favicon.ico",
  "resources": ["search", "stream", "settings"],
  "types": ["track"],
  "contentType": "music",
  "settings": [
    {
      "key": "audio_quality",
      "title": "Preferred Audio Quality",
      "type": "select",
      "default": "LOSSLESS",
      "options": [
        { "label": "Hi-Res Lossless (24-bit / 192kHz)", "value": "HI_RES_LOSSLESS" },
        { "label": "Lossless FLAC (16-bit / 44.1kHz)", "value": "LOSSLESS" },
        { "label": "High (320kbps AAC)", "value": "HIGH" }
      ]
    }
  ]
}
```

### 2. `GET /search?q={query}&quality={quality}`
Searches upstream tracks and maps them to BitChord's track schema.
```json
{
  "tracks": [
    {
      "id": "142283478",
      "title": "Yellow",
      "artist": "Coldplay",
      "album": "Parachutes",
      "duration": 266,
      "artworkURL": "https://resources.tidal.com/images/4e73f2aa/a392/4217/9150/14e4b4764834/640x640.jpg",
      "format": "flac",
      "audioQuality": "LOSSLESS",
      "isrc": "GBAYE0000038"
    }
  ]
}
```

### 3. `GET /stream/:id?quality={quality}`
Resolves a direct stream URL for playback.
```json
{
  "url": "https://swift-tld.tidal.com/audio/sample.flac?token=...",
  "format": "flac",
  "quality": "LOSSLESS",
  "mimeType": "audio/flac",
  "manifest": "none",
  "encrypted": false,
  "sampleRate": 44100,
  "bitDepth": 16,
  "headers": {
    "User-Agent": "Mozilla/5.0 ..."
  }
}
```

---

## 🛠 Local Development

```bash
# Clone the repository
git clone https://github.com/bitchord/bitchord-monochrome-addon.git
cd bitchord-monochrome-addon

# Install dependencies
npm install

# Start in development mode with live-reloading
npm run dev

# Run automated test suite
npm test

# Run live integration test against upstream instances
npm run test:live

# Type-check and build
npm run typecheck
npm run build
```

---

## 🐳 Docker Deployment

```bash
# Build the container
docker build -t bitchord-monochrome-addon .

# Run container
docker run -d -p 8080:8080 --name bitchord-monochrome-addon bitchord-monochrome-addon
```

Or using Docker Compose:
```bash
docker compose up -d
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
