import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const execFileAsync = promisify(execFile);

const YT_DLP_PATH = process.env.YT_DLP_PATH || path.join(process.cwd(), ".pythonlibs", "bin", "yt-dlp");
const COOKIES_PATH = process.env.COOKIES_PATH || path.join(process.cwd(), "cookies.txt");

function getCookiesArgs(): string[] {
  if (fs.existsSync(COOKIES_PATH)) {
    return ["--cookies", COOKIES_PATH];
  }
  return [];
}

let ffmpegAvailable: boolean | null = null;
async function checkFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  console.log(`ffmpeg available: ${ffmpegAvailable}`);
  return ffmpegAvailable;
}

interface VideoFormat {
  formatId: string;
  ext: string;
  quality: string;
  resolution: string;
  filesize: number | null;
  vcodec: string;
  acodec: string;
  type: "video" | "audio";
  fps: number | null;
  url?: string;
  hasAudio?: boolean;
}

interface VideoInfo {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: number;
  channel: string;
  viewCount: number;
  uploadDate: string;
  url: string;
  formats: VideoFormat[];
  platform: string;
  directUrl?: string;
  needsServerDownload?: boolean;
}

const analysisCache = new Map<string, { data: VideoInfo; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000;

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeUrl(url: string): string {
  return url.trim().replace(/[;&|`$(){}]/g, "");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\- ]/g, "_").slice(0, 100);
}

const ALLOWED_HOSTS = [
  "youtube.com", "youtu.be", "www.youtube.com", "m.youtube.com",
  "facebook.com", "www.facebook.com", "fb.watch", "m.facebook.com",
  "instagram.com", "www.instagram.com",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com", "t.tiktok.com",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com",
  "vimeo.com", "www.vimeo.com", "player.vimeo.com",
  "dailymotion.com", "www.dailymotion.com",
  "reddit.com", "www.reddit.com",
  "pinterest.com", "www.pinterest.com",
  "tumblr.com", "www.tumblr.com",
  "twitch.tv", "www.twitch.tv", "clips.twitch.tv",
  "soundcloud.com", "www.soundcloud.com",
  "bilibili.com", "www.bilibili.com",
];

function isAllowedHost(urlStr: string): boolean {
  try {
    const hostname = new URL(urlStr).hostname.toLowerCase();
    return ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith("." + h));
  } catch {
    return false;
  }
}

function sanitizeContentDisposition(filename: string): string {
  return filename.replace(/["\\\r\n]/g, "_");
}

function detectPlatform(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "Video";
  if (hostname.includes("facebook.com") || hostname.includes("fb.watch")) return "Facebook";
  if (hostname.includes("instagram.com")) return "Instagram";
  if (hostname.includes("tiktok.com")) return "TikTok";
  if (hostname.includes("twitter.com") || hostname.includes("x.com")) return "Twitter/X";
  if (hostname.includes("vimeo.com")) return "Vimeo";
  if (hostname.includes("dailymotion.com")) return "Dailymotion";
  if (hostname.includes("reddit.com")) return "Reddit";
  if (hostname.includes("twitch.tv")) return "Twitch";
  if (hostname.includes("soundcloud.com")) return "SoundCloud";
  return "Other";
}

function parseFormats(rawFormats: any[]): VideoFormat[] {
  if (!rawFormats) return [];

  const videoByRes = new Map<number, VideoFormat>();
  const audioFormats: VideoFormat[] = [];
  const seenAudioBitrate = new Set<number>();

  for (const f of rawFormats) {
    const hasVideo = f.vcodec && f.vcodec !== "none";
    const hasAudio = f.acodec && f.acodec !== "none";

    if (!hasVideo && !hasAudio) continue;

    if (hasVideo && f.height) {
      const height = f.height;
      const existing = videoByRes.get(height);
      const isH264 = f.vcodec?.startsWith("avc") || f.vcodec?.startsWith("h264");
      const existingIsH264 = existing?.vcodec?.startsWith("avc") || existing?.vcodec?.startsWith("h264");
      const hasBoth = hasVideo && hasAudio;
      const existingHasBoth = existing?.acodec !== "none";

      if (!existing || (hasBoth && !existingHasBoth) || (isH264 && !existingIsH264)) {
        videoByRes.set(height, {
          formatId: f.format_id,
          ext: f.ext || "mp4",
          quality: `${height}p`,
          resolution: `${f.width || "?"}x${height}`,
          filesize: f.filesize || f.filesize_approx || null,
          vcodec: f.vcodec || "none",
          acodec: f.acodec || "none",
          type: "video",
          fps: f.fps || null,
          url: f.url || undefined,
          hasAudio: hasBoth,
        });
      }
    } else if (!hasVideo && hasAudio) {
      const bitrate = f.abr ? Math.round(f.abr) : 0;
      if (bitrate > 0 && !seenAudioBitrate.has(bitrate)) {
        seenAudioBitrate.add(bitrate);
        audioFormats.push({
          formatId: f.format_id,
          ext: f.ext || "m4a",
          quality: `${bitrate}kbps`,
          resolution: "",
          filesize: f.filesize || f.filesize_approx || null,
          vcodec: "none",
          acodec: f.acodec || "none",
          type: "audio",
          fps: null,
        });
      }
    }
  }

  const videos = Array.from(videoByRes.values()).sort((a, b) => {
    const aH = parseInt(a.resolution.split("x")[1]) || 0;
    const bH = parseInt(b.resolution.split("x")[1]) || 0;
    return bH - aH;
  });

  const audios = audioFormats.sort((a, b) => {
    const aB = parseInt(a.quality) || 0;
    const bB = parseInt(b.quality) || 0;
    return bB - aB;
  });

  return [...videos, ...audios];
}

const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 30;
const RATE_WINDOW = 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);
  if (!entry || now > entry.resetTime) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

const TEMP_DIR = path.join(os.tmpdir(), "saveit-downloads");
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 10 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {}
}

setInterval(cleanupOldFiles, 5 * 60 * 1000);

function analyzeWithTimeout(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
      reject(new Error("timeout"));
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code !== 0) {
        const err: any = new Error(`yt-dlp exited with code ${code}`);
        err.stderr = stderr;
        reject(err);
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function downloadWithSpawn(args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
      reject(new Error("Download timed out"));
    }, timeoutMs);

    proc.stdout.on("data", () => {});

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 50000) {
        stderr = stderr.slice(-30000);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      resolve({ code: code || 0, stderr });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  checkFfmpeg();

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  app.post("/api/analyze", async (req: Request, res: Response) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: "Too many requests. Please try again later." });
      }

      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }

      const cleanUrl = sanitizeUrl(url);
      if (!isValidUrl(cleanUrl)) {
        return res.status(400).json({ error: "Invalid URL provided" });
      }

      if (!isAllowedHost(cleanUrl)) {
        return res.status(400).json({ error: "Unsupported platform. Supported: Facebook, Instagram, TikTok, Twitter/X, Vimeo, Dailymotion, and more" });
      }

      const cached = analysisCache.get(cleanUrl);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return res.json(cached.data);
      }

      const analyzeArgs = [
        "--dump-json",
        "--no-download",
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "--no-check-formats",
        "--skip-download",
        "--socket-timeout", "10",
        "--retries", "2",
        ...getCookiesArgs(),
        cleanUrl,
      ];

      console.log("Analyzing:", cleanUrl);
      const startTime = Date.now();

      const stdout = await analyzeWithTimeout(analyzeArgs, 45000);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Analyze completed in ${elapsed}s`);

      const rawInfo = JSON.parse(stdout);
      const formats = parseFormats(rawInfo.formats);

      const platform = detectPlatform(cleanUrl);
      const isYouTube = platform === "Video";

      let directUrl: string | undefined;
      let needsServerDownload = isYouTube;

      if (!isYouTube && rawInfo.formats && Array.isArray(rawInfo.formats)) {
        const combinedFormats = rawInfo.formats
          .filter((f: any) => {
            const hasVideo = f.vcodec && f.vcodec !== "none";
            const hasAudio = f.acodec && f.acodec !== "none";
            const hasUrl = f.url && f.url.startsWith("http");
            return hasVideo && hasAudio && hasUrl;
          })
          .sort((a: any, b: any) => (b.height || 0) - (a.height || 0));

        if (combinedFormats.length > 0) {
          const best = combinedFormats.find((f: any) => (f.ext === "mp4" || f.vcodec?.startsWith("avc"))) || combinedFormats[0];
          directUrl = best.url;
          needsServerDownload = false;
          console.log(`Direct URL found: ${best.format_id} ${best.height}p ${best.ext} (has audio: true)`);
        } else if (rawInfo.url && rawInfo.url.startsWith("http")) {
          directUrl = rawInfo.url;
          needsServerDownload = false;
          console.log(`Using rawInfo.url as direct URL`);
        } else {
          needsServerDownload = true;
          console.log(`No direct URL found for ${platform}, will use server download`);
        }
      }

      const cleanFormats = formats.map(f => {
        const { url: _url, ...rest } = f;
        return rest;
      });

      const videoInfo: VideoInfo = {
        id: rawInfo.id || "",
        title: rawInfo.title || "Unknown",
        description: (rawInfo.description || "").slice(0, 500),
        thumbnail: rawInfo.thumbnail || rawInfo.thumbnails?.[rawInfo.thumbnails.length - 1]?.url || "",
        duration: rawInfo.duration || 0,
        channel: rawInfo.channel || rawInfo.uploader || "Unknown",
        viewCount: rawInfo.view_count || 0,
        uploadDate: rawInfo.upload_date || "",
        url: cleanUrl,
        formats: cleanFormats,
        platform,
        directUrl,
        needsServerDownload,
      };

      analysisCache.set(cleanUrl, { data: videoInfo, timestamp: Date.now() });

      return res.json(videoInfo);
    } catch (error: any) {
      console.error("Analyze error:", error.message);
      console.error("Analyze stderr:", error.stderr || "none");
      if (error.message?.includes("timeout")) {
        return res.status(504).json({ error: "Analysis timed out. Try a shorter video or different URL." });
      }
      const stderrMsg = error.stderr || "";
      if (stderrMsg.includes("login required") || stderrMsg.includes("Sign in")) {
        return res.status(403).json({ error: "This platform requires authentication. Please set up cookies." });
      }
      return res.status(500).json({ error: "Failed to analyze video. Please check the URL and try again." });
    }
  });

  let activeDownloads = 0;
  const MAX_CONCURRENT_DOWNLOADS = 2;

  app.post("/api/download", async (req: Request, res: Response) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: "Too many requests" });
      }

      if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
        return res.status(503).json({ error: "Server is busy processing other downloads. Please try again in a minute." });
      }

      activeDownloads++;
      console.log(`Active downloads: ${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS}`);

      try {
        const { url, formatId, type, title, quality } = req.body;
        if (!url || typeof url !== "string") {
          return res.status(400).json({ error: "URL is required" });
        }

        const cleanUrl = sanitizeUrl(url);
        if (!isValidUrl(cleanUrl)) {
          return res.status(400).json({ error: "Invalid URL" });
        }

        if (!isAllowedHost(cleanUrl)) {
          return res.status(400).json({ error: "Unsupported platform" });
        }

        const hasFfmpeg = await checkFfmpeg();
        const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

        const args: string[] = [
          "--no-playlist",
          "--no-warnings",
          "--no-check-certificates",
          "--socket-timeout", "15",
          "--retries", "3",
          "--concurrent-fragments", "4",
          "--buffer-size", "16K",
          ...getCookiesArgs(),
        ];

        let ext: string;

        if (type === "audio") {
          ext = hasFfmpeg ? "mp3" : "m4a";
          const outputPath = path.join(TEMP_DIR, `${fileId}.${ext}`);
          args.push("-o", outputPath);

          if (hasFfmpeg) {
            args.push("-f", "bestaudio", "--extract-audio", "--audio-format", "mp3");
          } else {
            args.push("-f", "bestaudio[ext=m4a]/bestaudio");
          }
        } else {
          ext = "mp4";
          const outputPath = path.join(TEMP_DIR, `${fileId}.%(ext)s`);
          args.push("-o", outputPath);

          const resHeight = quality ? parseInt(quality) : 0;

          if (hasFfmpeg) {
            if (resHeight > 0) {
              args.push("-S", `res:${resHeight},vcodec:h264,acodec:aac,ext:mp4`);
            } else {
              args.push("-S", "vcodec:h264,acodec:aac,ext:mp4,res");
            }
            args.push("-f", "bv*+ba/b");
            args.push("--merge-output-format", "mp4");
            args.push("--remux-video", "mp4");
          } else {
            args.push("-f", "best[ext=mp4]/best");
          }
        }

        args.push(cleanUrl);

        console.log("Download started:", cleanUrl);
        const startTime = Date.now();

        const downloadTimeout = 30 * 60 * 1000;

        const result = await downloadWithSpawn(args, downloadTimeout);
        if (result.code !== 0) {
          console.error("yt-dlp error:", result.stderr);
          const stderrMsg = result.stderr;
          if (stderrMsg.includes("login required") || stderrMsg.includes("Sign in")) {
            return res.status(403).json({ error: "This platform requires authentication. Please set up cookies." });
          }
          return res.status(500).json({ error: `Download failed: ${stderrMsg.split('\n').filter((l: string) => l.startsWith('ERROR')).join('; ') || 'Unknown error'}` });
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`Download completed in ${elapsed}s`);

        const safeTitle = sanitizeFilename(title || "video");

        const actualFiles = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(fileId));
        if (actualFiles.length === 0) {
          return res.status(500).json({ error: "Download failed - file not created" });
        }

        const actualFile = actualFiles[0];
        const actualExt = path.extname(actualFile).slice(1);
        const correctedFilename = `${safeTitle}.${actualExt}`;

        return res.json({
          fileId: actualFile,
          filename: correctedFilename,
          downloadPath: `/api/file/${actualFile}?name=${encodeURIComponent(correctedFilename)}`,
        });
      } catch (error: any) {
        console.error("Download error:", error.message);
        if (error.message?.includes("timed out")) {
          return res.status(504).json({ error: "Download timed out. Video might be too long or slow." });
        }
        return res.status(500).json({ error: "Failed to download video. Please try again." });
      } finally {
        activeDownloads--;
        console.log(`Download slot freed. Active: ${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS}`);
      }
    } catch (outerError: any) {
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/file/:fileId", (req: Request, res: Response) => {
    try {
      const { fileId } = req.params;
      const safeName = fileId.replace(/[^a-zA-Z0-9._-]/g, "");
      const filePath = path.join(TEMP_DIR, safeName);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found or expired" });
      }

      const stat = fs.statSync(filePath);
      const filename = (req.query.name as string) || safeName;
      const ext = path.extname(safeName).toLowerCase();

      let contentType = "application/octet-stream";
      if (ext === ".mp4") contentType = "video/mp4";
      else if (ext === ".mp3") contentType = "audio/mpeg";
      else if (ext === ".m4a") contentType = "audio/mp4";
      else if (ext === ".webm") contentType = "video/webm";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeContentDisposition(filename)}"`);

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);

      stream.on("end", () => {
        setTimeout(() => {
          try { fs.unlinkSync(filePath); } catch {}
        }, 60000);
      });
    } catch (error: any) {
      console.error("File serve error:", error.message);
      return res.status(500).json({ error: "Failed to serve file" });
    }
  });

  app.post("/api/get-url", async (req: Request, res: Response) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: "Too many requests" });
      }

      const { url, type, quality } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }

      const cleanUrl = sanitizeUrl(url);
      if (!isValidUrl(cleanUrl)) {
        return res.status(400).json({ error: "Invalid URL" });
      }

      if (!isAllowedHost(cleanUrl)) {
        return res.status(400).json({ error: "Unsupported platform" });
      }

      const platform = detectPlatform(cleanUrl);
      const needsServerMerge = platform === "Video" || type === "audio";

      if (needsServerMerge) {
        return res.json({ error: "Platform requires server-side processing", fallback: true });
      }

      const args = [
        "-g",
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        "--socket-timeout", "10",
        ...getCookiesArgs(),
        "-f", "best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best",
        cleanUrl,
      ];

      const stdout = await analyzeWithTimeout(args, 20000);

      const urls = stdout.trim().split("\n").filter((u: string) => u.startsWith("http"));

      if (urls.length === 0) {
        return res.json({ error: "Direct URL not available", fallback: true });
      }

      if (urls.length === 1) {
        return res.json({ directUrl: urls[0], method: "direct" });
      }

      return res.json({ error: "Multiple streams detected, requires server merge", fallback: true });
    } catch (error: any) {
      console.error("Get-URL error:", error.stderr || error.message);
      return res.json({ error: "Direct URL not available", fallback: true });
    }
  });

  app.get("/api/thumbnail", async (req: Request, res: Response) => {
    try {
      const { url } = req.query;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }

      const cleanUrl = sanitizeUrl(url);
      if (!isValidUrl(cleanUrl)) {
        return res.status(400).json({ error: "Invalid URL" });
      }

      const stdout = await analyzeWithTimeout([
        "--get-thumbnail",
        "--no-download",
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        cleanUrl,
      ], 15000);

      const thumbnailUrl = stdout.trim();
      return res.json({ thumbnailUrl });
    } catch (error: any) {
      console.error("Thumbnail error:", error.message);
      return res.status(500).json({ error: "Failed to get thumbnail" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
