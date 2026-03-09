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
    console.log(`Using cookies from: ${COOKIES_PATH}`);
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

      if (!existing || (isH264 && !existingIsH264) || (!existing && !isH264)) {
        const hasBothTracks = hasVideo && hasAudio;
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

export async function registerRoutes(app: Express): Promise<Server> {
  checkFfmpeg();

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
        ...getCookiesArgs(),
        cleanUrl,
      ];

      const { stdout, stderr } = await execFileAsync(YT_DLP_PATH, analyzeArgs, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });

      const rawInfo = JSON.parse(stdout);
      const formats = parseFormats(rawInfo.formats);

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
        formats,
        platform: detectPlatform(cleanUrl),
      };

      analysisCache.set(cleanUrl, { data: videoInfo, timestamp: Date.now() });

      return res.json(videoInfo);
    } catch (error: any) {
      console.error("Analyze error:", error.message);
      console.error("Analyze stderr:", error.stderr || "none");
      if (error.message?.includes("timeout")) {
        return res.status(504).json({ error: "Request timed out. The video might be unavailable." });
      }
      return res.status(500).json({ error: "Failed to analyze video. Please check the URL and try again." });
    }
  });

  app.post("/api/download", async (req: Request, res: Response) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: "Too many requests" });
      }

      const { url, formatId, type, title } = req.body;
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

        if (hasFfmpeg) {
          args.push("-S", "vcodec:h264,acodec:aac,ext:mp4,res");
          args.push("-f", "bv*+ba/b");
          args.push("--merge-output-format", "mp4");
        } else {
          args.push("-f", "best[ext=mp4]/best");
        }
      }

      args.push(cleanUrl);

      console.log("Download args:", args.join(" "));

      try {
        await execFileAsync(YT_DLP_PATH, args, {
          timeout: 300000,
          maxBuffer: 10 * 1024 * 1024,
        });
      } catch (dlError: any) {
        console.error("yt-dlp error:", dlError.message);
        console.error("yt-dlp stderr:", dlError.stderr || "none");
        return res.status(500).json({ error: `Download failed: ${dlError.stderr?.split('\n').filter((l: string) => l.startsWith('ERROR')).join('; ') || 'Unknown error'}` });
      }

      const safeTitle = sanitizeFilename(title || "video");
      const finalFilename = `${safeTitle}.${ext}`;

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
      return res.status(500).json({ error: "Failed to download video. Please try again." });
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

      const { stdout } = await execFileAsync(YT_DLP_PATH, [
        "--get-thumbnail",
        "--no-download",
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        cleanUrl,
      ], { timeout: 15000 });

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
