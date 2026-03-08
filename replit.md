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
- yt-dlp (installed via pip at `.pythonlibs/bin/yt-dlp`, configurable via `YT_DLP_PATH` env var) for video metadata and downloading
- ffmpeg (system dependency) for audio extraction and format conversion
- expo-file-system (legacy API) for in-app file downloads
- expo-sharing for save/share functionality
- expo-clipboard for URL paste support
- esbuild for server production bundling

## Project Structure
```
app/
  _layout.tsx          # Root layout with providers
  (tabs)/
    _layout.tsx        # Tab layout (Download + History)
    index.tsx          # Main download screen
    history.tsx        # Download history screen
components/
  URLInput.tsx         # URL input with paste button
  VideoPreview.tsx     # Video thumbnail + metadata display
  FormatSelector.tsx   # Video/Audio toggle + format chips
  DownloadButton.tsx   # Download action button
  HistoryItem.tsx      # History list item
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
  routes.ts            # API endpoints (/api/analyze, /api/download, /api/file, /api/thumbnail)
  templates/           # Landing page HTML template
```

## API Endpoints
- `POST /api/analyze` - Analyze a video URL, returns metadata + available formats
- `POST /api/download` - Download video/audio to temp file on server, returns file path
- `GET /api/file/:fileId` - Stream downloaded file to client
- `GET /api/thumbnail` - Get video thumbnail URL

## Key Features
- URL analysis with metadata display (title, channel, duration, views)
- Video/Audio format selection with quality options
- In-app download with progress tracking
- Share sheet integration for saving files
- Download history with AsyncStorage persistence
- Platform detection (YouTube, Facebook, Instagram, TikTok, Twitter/X, Vimeo, Dailymotion)
- Rate limiting and URL validation
- Server-side caching for repeated requests
- Dark/light mode support

## Deployment
- **Dockerfile**: Backend Docker image with Node.js, Python (yt-dlp), and ffmpeg
- **eas.json**: EAS Build config for .apk (preview) and .aab (production) builds
- **Oracle Cloud**: See `ORACLE_CLOUD_DEPLOYMENT.md` for full deployment guide
- Backend port: 5000, Expo dev server: 8081
- `EXPO_PUBLIC_DOMAIN` env var controls which backend the app connects to

## Important Notes
- yt-dlp path is configurable via `YT_DLP_PATH` env var (defaults to `.pythonlibs/bin/yt-dlp` in dev, `/opt/venv/bin/yt-dlp` in Docker)
- Downloads use legacy expo-file-system API (`expo-file-system/legacy`)
- Temp files are cleaned up after 10 minutes
- Android package: `com.saveit.app`, iOS bundle: `com.saveit.app`
