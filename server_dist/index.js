// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
var execFileAsync = promisify(execFile);
var YT_DLP_PATH = process.env.YT_DLP_PATH || path.join(process.cwd(), ".pythonlibs", "bin", "yt-dlp");
var analysisCache = /* @__PURE__ */ new Map();
var CACHE_TTL = 10 * 60 * 1e3;
function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function sanitizeUrl(url) {
  return url.trim().replace(/[;&|`$(){}]/g, "");
}
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._\- ]/g, "_").slice(0, 100);
}
var ALLOWED_HOSTS = [
  "youtube.com",
  "youtu.be",
  "www.youtube.com",
  "m.youtube.com",
  "facebook.com",
  "www.facebook.com",
  "fb.watch",
  "instagram.com",
  "www.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
  "vm.tiktok.com",
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
  "dailymotion.com",
  "www.dailymotion.com"
];
function isAllowedHost(urlStr) {
  try {
    const hostname = new URL(urlStr).hostname.toLowerCase();
    return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h));
  } catch {
    return false;
  }
}
function sanitizeContentDisposition(filename) {
  return filename.replace(/["\\\r\n]/g, "_");
}
function detectPlatform(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "Video";
  if (hostname.includes("facebook.com") || hostname.includes("fb.watch")) return "Facebook";
  if (hostname.includes("instagram.com")) return "Instagram";
  if (hostname.includes("tiktok.com")) return "TikTok";
  if (hostname.includes("twitter.com") || hostname.includes("x.com")) return "Twitter/X";
  if (hostname.includes("vimeo.com")) return "Vimeo";
  if (hostname.includes("dailymotion.com")) return "Dailymotion";
  return "Other";
}
function parseFormats(rawFormats) {
  if (!rawFormats) return [];
  const seen = /* @__PURE__ */ new Set();
  const formats = [];
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
      fps: f.fps || null
    });
  }
  return formats.sort((a, b) => {
    if (a.type !== b.type) return a.type === "video" ? -1 : 1;
    const aH = parseInt(a.resolution.split("x")[1]) || 0;
    const bH = parseInt(b.resolution.split("x")[1]) || 0;
    return bH - aH;
  });
}
var requestCounts = /* @__PURE__ */ new Map();
var RATE_LIMIT = 30;
var RATE_WINDOW = 60 * 1e3;
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = requestCounts.get(ip);
  if (!entry || now > entry.resetTime) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}
var TEMP_DIR = path.join(os.tmpdir(), "saveit-downloads");
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
      if (now - stat.mtimeMs > 10 * 60 * 1e3) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
  }
}
setInterval(cleanupOldFiles, 5 * 60 * 1e3);
async function registerRoutes(app2) {
  app2.post("/api/analyze", async (req, res) => {
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
      const { stdout } = await execFileAsync(YT_DLP_PATH, [
        "--dump-json",
        "--no-download",
        "--no-playlist",
        "--no-warnings",
        cleanUrl
      ], { timeout: 3e4, maxBuffer: 10 * 1024 * 1024 });
      const rawInfo = JSON.parse(stdout);
      const formats = parseFormats(rawInfo.formats);
      const videoInfo = {
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
        platform: detectPlatform(cleanUrl)
      };
      analysisCache.set(cleanUrl, { data: videoInfo, timestamp: Date.now() });
      return res.json(videoInfo);
    } catch (error) {
      console.error("Analyze error:", error.message);
      if (error.message?.includes("timeout")) {
        return res.status(504).json({ error: "Request timed out. The video might be unavailable." });
      }
      return res.status(500).json({ error: "Failed to analyze video. Please check the URL and try again." });
    }
  });
  app2.post("/api/download", async (req, res) => {
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
      const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const ext = type === "audio" ? "mp3" : "mp4";
      const outputFilename = `${fileId}.${ext}`;
      const outputPath = path.join(TEMP_DIR, outputFilename);
      const args = [
        "--no-playlist",
        "--no-warnings",
        "-o",
        outputPath
      ];
      if (type === "audio") {
        args.push("-f", "bestaudio", "--extract-audio", "--audio-format", "mp3");
      } else {
        args.push("-S", "vcodec:h264,ext:mp4,res");
        args.push("-f", "bv*+ba/b");
        args.push("--merge-output-format", "mp4");
        args.push("--postprocessor-args", "ffmpeg:-c:v libx264 -c:a aac -movflags +faststart");
      }
      args.push(cleanUrl);
      await execFileAsync(YT_DLP_PATH, args, {
        timeout: 3e5,
        maxBuffer: 10 * 1024 * 1024
      });
      const safeTitle = sanitizeFilename(title || "video");
      const finalFilename = `${safeTitle}.${ext}`;
      const actualFiles = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(fileId));
      if (actualFiles.length === 0) {
        return res.status(500).json({ error: "Download failed - file not created" });
      }
      const actualFile = actualFiles[0];
      const actualPath = path.join(TEMP_DIR, actualFile);
      return res.json({
        fileId: actualFile,
        filename: finalFilename,
        downloadPath: `/api/file/${actualFile}?name=${encodeURIComponent(finalFilename)}`
      });
    } catch (error) {
      console.error("Download error:", error.message);
      return res.status(500).json({ error: "Failed to download video. Please try again." });
    }
  });
  app2.get("/api/file/:fileId", (req, res) => {
    try {
      const { fileId } = req.params;
      const safeName = fileId.replace(/[^a-zA-Z0-9._-]/g, "");
      const filePath = path.join(TEMP_DIR, safeName);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found or expired" });
      }
      const stat = fs.statSync(filePath);
      const filename = req.query.name || safeName;
      const ext = path.extname(safeName).toLowerCase();
      let contentType = "application/octet-stream";
      if (ext === ".mp4") contentType = "video/mp4";
      else if (ext === ".mp3") contentType = "audio/mpeg";
      else if (ext === ".webm") contentType = "video/webm";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeContentDisposition(filename)}"`);
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on("end", () => {
        setTimeout(() => {
          try {
            fs.unlinkSync(filePath);
          } catch {
          }
        }, 6e4);
      });
    } catch (error) {
      console.error("File serve error:", error.message);
      return res.status(500).json({ error: "Failed to serve file" });
    }
  });
  app2.get("/api/thumbnail", async (req, res) => {
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
        cleanUrl
      ], { timeout: 15e3 });
      const thumbnailUrl = stdout.trim();
      return res.json({ thumbnailUrl });
    } catch (error) {
      console.error("Thumbnail error:", error.message);
      return res.status(500).json({ error: "Failed to get thumbnail" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
import * as fs2 from "fs";
import * as path2 from "path";
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path3 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path3.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path2.resolve(process.cwd(), "app.json");
    const appJsonContent = fs2.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path2.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs2.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs2.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const templatePath = path2.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs2.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express.static(path2.resolve(process.cwd(), "assets")));
  app2.use(express.static(path2.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
})();
