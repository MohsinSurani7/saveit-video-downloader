import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const execFileAsync = promisify(execFile);

const YT_DLP_PATH = path.join(process.cwd(), ".pythonlibs", "bin", "yt-dlp");

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

function detectPlatform(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "YouTube";
  if (hostname.includes("facebook.com") || hostname.includes("fb.watch")) return "Facebook";
  if (hostname.includes("instagram.com")) return "Instagram";
  if (hostname.includes("tiktok.com")) return "TikTok";
  if (hostname.includes("twitter.com") || hostname.includes("x.com")) return "Twitter/X";
  if (hostname.includes("vimeo.com")) return "Vimeo";
  if (hostname.includes("dailymotion.com")) return "Dailymotion";
  return "Other";
}

function parseFormats(rawFormats: any[]): VideoFormat[] {
  if (!rawFormats) return [];

  const seen = new Set<string>();
  const formats: VideoFormat[] = [];

  for (const f of rawFormats) {
    const key = `${f.format_id}-${f.ext}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const hasVideo = f.vcodec && f.vcodec !== "none";
    const hasAudio = f.acodec && f.acodec !== "none";

    if (!hasVideo && !hasAudio) continue;

    let quality = f.format_note || f.quality || "unknown";
    let resolution = "";

    if (hasVideo && f.height) {
      resolution = `${f.width || "?"}x${f.height}`;
      if (!f.format_note) {
        quality = `${f.height}p`;
      }
    } else if (!hasVideo && hasAudio) {
      quality = f.abr ? `${Math.round(f.abr)}kbps` : "audio";
    }

    formats.push({
      formatId: f.format_id,
      ext: f.ext || "mp4",
      quality,
      resolution,
      filesize: f.filesize || f.filesize_approx || null,
      vcodec: f.vcodec || "none",
      acodec: f.acodec || "none",
      type: hasVideo ? "video" : "audio",
      fps: f.fps || null,
    });
  }

  return formats.sort((a, b) => {
    if (a.type !== b.type) return a.type === "video" ? -1 : 1;
    const aH = parseInt(a.resolution.split("x")[1]) || 0;
    const bH = parseInt(b.resolution.split("x")[1]) || 0;
    return bH - aH;
  });
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

export async function registerRoutes(app: Express): Promise<Server> {
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

      const cached = analysisCache.get(cleanUrl);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return res.json(cached.data);
      }

      const { stdout } = await execFileAsync(YT_DLP_PATH, [
        "--dump-json",
        "--no-download",
        "--no-playlist",
        "--no-warnings",
        cleanUrl,
      ], { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });

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

      const { url, formatId, type } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }

      const cleanUrl = sanitizeUrl(url);
      if (!isValidUrl(cleanUrl)) {
        return res.status(400).json({ error: "Invalid URL" });
      }

      const args: string[] = [
        "--no-playlist",
        "--no-warnings",
        "-g",
        cleanUrl,
      ];

      if (type === "audio") {
        args.splice(args.length - 1, 0, "-f", "bestaudio");
      } else if (formatId) {
        args.splice(args.length - 1, 0, "-f", `${formatId}+bestaudio/best`);
      } else {
        args.splice(args.length - 1, 0, "-f", "best");
      }

      const { stdout } = await execFileAsync(YT_DLP_PATH, args, {
        timeout: 30000,
      });

      const downloadUrl = stdout.trim().split("\n")[0];
      return res.json({ downloadUrl });
    } catch (error: any) {
      console.error("Download error:", error.message);
      return res.status(500).json({ error: "Failed to get download link" });
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
