# SaveIt - Video Downloader App

## Overview
SaveIt is a mobile-first video downloader app built with Expo (React Native) and Express backend. Users can paste video URLs, analyze them, select format/quality, and download videos and audio directly within the app.

## Architecture
- **Frontend**: Expo Router (file-based routing) with React Native, TypeScript
- **Backend**: Express.js with TypeScript, using yt-dlp for video extraction
- **State**: React Query for server state, AsyncStorage for download history

## Tech Stack
- Expo SDK 54 with React Native
- Express.js backend on port 5000
- yt-dlp for video metadata and downloading
- ffmpeg for audio extraction and format conversion
- expo-file-system (legacy API) for in-app file downloads
- expo-media-library for saving downloads to device gallery
- expo-clipboard for URL paste support
- esbuild for server production bundling

## Project Structure
```
app/
  _layout.tsx          # Root layout with providers
  player.tsx           # Full-screen VLC-style offline video player
  (tabs)/
    _layout.tsx        # Tab layout (Download + History)
    index.tsx          # Main download screen (1-tap quality download)
    history.tsx        # Download history screen (tap to play)
components/
  URLInput.tsx         # URL input with HD/SD/Best quality buttons
  VideoPreview.tsx     # Video thumbnail + metadata display
  HistoryItem.tsx      # History list item with play overlay
  ErrorBoundary.tsx    # Error boundary wrapper
  ErrorFallback.tsx    # Error fallback UI
constants/
  colors.ts            # Theme colors (light/dark)
lib/
  types.ts             # TypeScript interfaces
  useTheme.ts          # Theme hook
  history.ts           # AsyncStorage history helpers
  query-client.ts      # React Query + API helpers
server/
  index.ts             # Express server setup
  routes.ts            # API endpoints
  templates/           # Landing page HTML template
```

## API Endpoints
- `POST /api/analyze` - Analyze a video URL, returns metadata + available formats
- `POST /api/download` - Download video/audio to temp file on server, returns file path
- `POST /api/get-url` - Get direct CDN URL for client-side download (bypasses server)
- `GET /api/file/:fileId` - Stream downloaded file to client
- `GET /api/thumbnail` - Get video thumbnail URL

## Key Features
- **1-Tap Download**: Paste URL → tap HD/SD/Best → instant download (FastVid-style)
- **Direct URL download**: Non-YouTube platforms download from CDN (zero server load)
- **Pause/Resume/Cancel**: Download controls during active transfers
- **Offline Video Player**: VLC-style full-screen player with play/pause, seek, speed control
- History items tap to play downloaded videos offline
- In-app download with progress tracking
- Direct save to device gallery
- Download history with AsyncStorage persistence (tracks local file paths)
- Platform detection (Facebook, Instagram, TikTok, Twitter/X, Vimeo, Reddit, Twitch, SoundCloud, Bilibili, Pinterest, Dailymotion)
- Rate limiting and URL validation
- Server-side caching for repeated requests
- Dark/light mode support

## Deployment
- **Oracle Cloud**: Backend at 207.127.102.112:5000 with systemd service (`saveit.service`)
- **yt-dlp**: `/home/opc/.local/bin/yt-dlp` (standalone binary)
- **ffmpeg**: `/usr/local/bin/ffmpeg` (static binary)
- **eas.json**: EAS Build config for .apk (preview) and .aab (production) builds
- Backend port: 5000, Expo dev server: 8081
- `EXPO_PUBLIC_DOMAIN` env var controls which backend the app connects to
- To update Oracle server: `curl -L -o server_dist/index.js "https://raw.githubusercontent.com/MohsinSurani7/saveit-video-downloader/main/server_dist/index.js" && sudo systemctl restart saveit`

## Important Notes
- yt-dlp path configurable via `YT_DLP_PATH` env var
- Cookies support via `COOKIES_PATH` env var (needed for YouTube/Instagram)
- Downloads use legacy expo-file-system API (`expo-file-system/legacy`)
- Temp files cleaned up after 10 minutes
- Android package: `com.saveit.app`, iOS bundle: `com.saveit.app`
