// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as https from "node:https";
import * as http from "node:http";
var execFileAsync = promisify(execFile);
function resolveYtDlpCommand() {
  const envPath = process.env.YT_DLP_PATH?.trim();
  if (envPath) {
    return { command: envPath, baseArgs: [] };
  }
  const candidatePaths = [
    path.join(process.cwd(), ".pythonlibs", "bin", "yt-dlp"),
    path.join(process.cwd(), ".pythonlibs", "bin", "yt-dlp.exe"),
    path.join(process.cwd(), ".pythonlibs", "Scripts", "yt-dlp.exe"),
    path.join(process.cwd(), ".venv", "Scripts", "yt-dlp.exe"),
    path.join(process.cwd(), ".venv", "bin", "yt-dlp")
  ];
  const localBinary = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (localBinary) {
    return { command: localBinary, baseArgs: [] };
  }
  if (process.env.YT_DLP_USE_PYTHON_MODULE === "1") {
    return {
      command: process.env.PYTHON_PATH || "python",
      baseArgs: ["-m", "yt_dlp"]
    };
  }
  return {
    command: process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
    baseArgs: []
  };
}
var YT_DLP_COMMAND = resolveYtDlpCommand();
var COOKIES_PATH = process.env.COOKIES_PATH || path.join(process.cwd(), "cookies.txt");
var CUSTOM_PROXY = process.env.PROXY_URL || "";
function getCookiesArgs() {
  if (fs.existsSync(COOKIES_PATH)) {
    return ["--cookies", COOKIES_PATH];
  }
  return [];
}
var proxyList = [];
var proxyLastFetch = 0;
var PROXY_CACHE_TTL = 30 * 60 * 1e3;
var proxyIndex = 0;
async function httpGet(url) {
  return new Promise((resolve2, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: 1e4 }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk.toString();
      });
      res.on("end", () => resolve2(data));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}
async function fetchProxies() {
  const now = Date.now();
  if (proxyList.length > 0 && now - proxyLastFetch < PROXY_CACHE_TTL) {
    return proxyList;
  }
  if (CUSTOM_PROXY) {
    proxyList = [CUSTOM_PROXY];
    proxyLastFetch = now;
    console.log("Using custom proxy:", CUSTOM_PROXY);
    return proxyList;
  }
  const sources = [
    { url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=5000&country=all&ssl=all&anonymity=all", type: "socks5" },
    { url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt", type: "socks5" },
    { url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt", type: "socks5" },
    { url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=elite", type: "http" },
    { url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt", type: "http" },
    { url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt", type: "http" }
  ];
  const allProxies = [];
  for (const source of sources) {
    try {
      const data = await httpGet(source.url);
      const proxies = data.split("\n").map((p) => p.trim()).filter((p) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(p)).map((p) => source.type === "socks5" ? `socks5://${p}` : `http://${p}`);
      allProxies.push(...proxies);
    } catch (err) {
      console.log(`Proxy source failed: ${err.message}`);
    }
  }
  const unique = [...new Set(allProxies)];
  const socks5 = unique.filter((p) => p.startsWith("socks5://"));
  const httpProxies = unique.filter((p) => p.startsWith("http://"));
  const shuffled = [
    ...socks5.sort(() => Math.random() - 0.5),
    ...httpProxies.sort(() => Math.random() - 0.5)
  ].slice(0, 200);
  if (shuffled.length > 0) {
    proxyList = shuffled;
    proxyLastFetch = now;
    proxyIndex = 0;
    console.log(`Fetched ${shuffled.length} proxies`);
  } else {
    console.log("No proxies fetched, will try direct");
  }
  return proxyList;
}
function getNextProxy() {
  if (proxyList.length === 0) return null;
  const proxy = proxyList[proxyIndex % proxyList.length];
  proxyIndex++;
  return proxy;
}
function markProxyBad(proxyUrl) {
  proxyList = proxyList.filter((p) => p !== proxyUrl);
  console.log(`Removed bad proxy, ${proxyList.length} remaining`);
}
var ffmpegAvailable = null;
async function checkFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 5e3 });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  console.log(`ffmpeg available: ${ffmpegAvailable}`);
  return ffmpegAvailable;
}
var analysisCache = /* @__PURE__ */ new Map();
var CACHE_TTL = 10 * 60 * 1e3;
var BACKOFF_MS = [0, 800, 1600];
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
function normalizeUrl(inputUrl) {
  try {
    const parsed = new URL(inputUrl);
    const host = parsed.hostname.toLowerCase();
    const normalizedHost = host.replace(/^m\./, "").replace(/^www\./, "");
    if (normalizedHost === "youtu.be") {
      const videoId = parsed.pathname.split("/").filter(Boolean)[0];
      if (videoId) {
        const next = new URL("https://www.youtube.com/watch");
        next.searchParams.set("v", videoId);
        return next.toString();
      }
    }
    if (normalizedHost === "youtube.com") {
      if (parsed.pathname.startsWith("/shorts/")) {
        const videoId = parsed.pathname.split("/").filter(Boolean)[1];
        if (videoId) {
          const next = new URL("https://www.youtube.com/watch");
          next.searchParams.set("v", videoId);
          return next.toString();
        }
      }
      if (parsed.pathname === "/watch") {
        const next = new URL("https://www.youtube.com/watch");
        const v = parsed.searchParams.get("v");
        if (v) {
          next.searchParams.set("v", v);
          return next.toString();
        }
      }
    }
    if (normalizedHost === "instagram.com") {
      parsed.search = "";
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return inputUrl;
  }
}
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function mapYtDlpError(stderrText) {
  const stderrMsg = (stderrText || "").toLowerCase();
  if (stderrMsg.includes("timed out") || stderrMsg.includes("timeout")) {
    return {
      bucket: "timeout",
      status: 504,
      message: "Request timed out while contacting the video platform. Please retry."
    };
  }
  if (stderrMsg.includes("login required") || stderrMsg.includes("sign in") || stderrMsg.includes("authentication")) {
    return {
      bucket: "private_or_restricted",
      status: 422,
      message: "This video is private or restricted by the platform. Please try a public link."
    };
  }
  if (stderrMsg.includes("rate-limit") || stderrMsg.includes("too many requests")) {
    return {
      bucket: "rate_limited",
      status: 429,
      message: "Platform rate limit reached. Please retry in a few minutes."
    };
  }
  if (stderrMsg.includes("blocked") || stderrMsg.includes("forbidden") || stderrMsg.includes("403") || stderrMsg.includes("geo")) {
    return {
      bucket: "geo_or_network",
      status: 403,
      message: "This content is blocked in the current server region or by network policy."
    };
  }
  if (stderrMsg.includes("not available") || stderrMsg.includes("removed") || stderrMsg.includes("deleted") || stderrMsg.includes("private video")) {
    return {
      bucket: "not_found_or_removed",
      status: 404,
      message: "This video is not available anymore or has been removed."
    };
  }
  if (stderrMsg.includes("no video") || stderrMsg.includes("unable to extract")) {
    return {
      bucket: "unsupported_or_extract_failed",
      status: 422,
      message: "Could not extract this link. Try a direct public post/video URL."
    };
  }
  return {
    bucket: "unknown",
    status: 500,
    message: "Unable to process this URL right now. Please try again."
  };
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
  "m.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "ok.ru",
  "www.ok.ru",
  "ok.com",
  "www.ok.com",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
  "dailymotion.com",
  "www.dailymotion.com",
  "reddit.com",
  "www.reddit.com",
  "pinterest.com",
  "www.pinterest.com",
  "tumblr.com",
  "www.tumblr.com",
  "twitch.tv",
  "www.twitch.tv",
  "clips.twitch.tv",
  "soundcloud.com",
  "www.soundcloud.com",
  "bilibili.com",
  "www.bilibili.com"
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
  if (hostname.includes("ok.ru") || hostname.includes("ok.com")) return "OK";
  if (hostname.includes("tiktok.com")) return "TikTok";
  if (hostname.includes("twitter.com") || hostname.includes("x.com")) return "Twitter/X";
  if (hostname.includes("vimeo.com")) return "Vimeo";
  if (hostname.includes("dailymotion.com")) return "Dailymotion";
  if (hostname.includes("reddit.com")) return "Reddit";
  if (hostname.includes("twitch.tv")) return "Twitch";
  if (hostname.includes("soundcloud.com")) return "SoundCloud";
  return "Other";
}
function buildAnalyzeStrategies(platform, cleanUrl) {
  const base = [
    "--dump-json",
    "--no-download",
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificates",
    "--no-check-formats",
    "--skip-download",
    "--socket-timeout",
    platform === "Video" ? "20" : "15",
    "--retries",
    platform === "Video" ? "3" : "2",
    ...getCookiesArgs()
  ];
  const strategies = [];
  strategies.push([...base, cleanUrl]);
  if (["Instagram", "Twitter/X", "Video"].includes(platform)) {
    strategies.push([...base, "--impersonate", "Chrome", cleanUrl]);
  }
  if (platform === "Video") {
    strategies.push([
      ...base,
      "--extractor-args",
      "youtube:player_client=android,web",
      "--impersonate",
      "Chrome",
      cleanUrl
    ]);
  }
  return strategies;
}
function isRetryableAnalyzeError(stderrText) {
  const stderrMsg = (stderrText || "").toLowerCase();
  return stderrMsg.includes("timed out") || stderrMsg.includes("timeout") || stderrMsg.includes("429") || stderrMsg.includes("rate-limit") || stderrMsg.includes("http error 5") || stderrMsg.includes("temporary");
}
async function runAnalyzeStrategies(platform, cleanUrl) {
  const strategies = buildAnalyzeStrategies(platform, cleanUrl);
  let lastError = new Error("No analyze strategy attempted");
  for (let attempt = 0; attempt < strategies.length; attempt++) {
    const args = strategies[attempt];
    try {
      if (BACKOFF_MS[attempt]) {
        await sleep(BACKOFF_MS[attempt]);
      }
      return await analyzeWithTimeout(args, attempt === 0 ? 45e3 : 35e3);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableAnalyzeError(error?.stderr || error?.message || "");
      if (!retryable && attempt === 0 && strategies.length > 1) {
        continue;
      }
    }
  }
  throw lastError;
}
function buildDownloadStrategies({
  platform,
  cleanUrl,
  outputPath,
  type,
  quality,
  hasFfmpeg
}) {
  const common = [
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificates",
    "--socket-timeout",
    "20",
    "--retries",
    "4",
    "--concurrent-fragments",
    "4",
    "--buffer-size",
    "16K",
    ...getCookiesArgs(),
    ...platform === "Instagram" || platform === "Twitter/X" || platform === "Video" ? ["--impersonate", "Chrome"] : [],
    "-o",
    outputPath
  ];
  if (type === "audio") {
    if (hasFfmpeg) {
      return [
        [...common, "-f", "bestaudio", "--extract-audio", "--audio-format", "mp3", cleanUrl],
        [...common, "-f", "bestaudio[ext=m4a]/bestaudio", cleanUrl]
      ];
    }
    return [[...common, "-f", "bestaudio[ext=m4a]/bestaudio", cleanUrl]];
  }
  const resHeight = quality ? parseInt(quality, 10) : 0;
  if (hasFfmpeg) {
    const sortExpr = resHeight > 0 ? `res:${resHeight},vcodec:h264,acodec:aac,ext:mp4` : "vcodec:h264,acodec:aac,ext:mp4,res";
    return [
      [
        ...common,
        "-S",
        sortExpr,
        "-f",
        "bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "--remux-video",
        "mp4",
        cleanUrl
      ],
      [...common, "-f", "best[ext=mp4][vcodec!=none][acodec!=none]/best", cleanUrl],
      [...common, "-f", "best", cleanUrl]
    ];
  }
  return [
    [...common, "-f", "best[ext=mp4]/best", cleanUrl],
    [...common, "-f", "best", cleanUrl]
  ];
}
async function runYtDlpAutoUpdate() {
  try {
    const args = [...YT_DLP_COMMAND.baseArgs, "-U"];
    await execFileAsync(YT_DLP_COMMAND.command, args, { timeout: 45e3 });
    console.log("yt-dlp update check completed");
  } catch (error) {
    console.log(`yt-dlp auto-update skipped/failed: ${error?.message || "unknown"}`);
  }
}
function parseFormats(rawFormats) {
  if (!rawFormats) return [];
  const videoByRes = /* @__PURE__ */ new Map();
  const audioFormats = [];
  const seenAudioBitrate = /* @__PURE__ */ new Set();
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
      if (!existing || hasBoth && !existingHasBoth || isH264 && !existingIsH264) {
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
          url: f.url || void 0,
          hasAudio: hasBoth
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
          fps: null
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
function analyzeWithTimeout(args, timeoutMs) {
  return new Promise((resolve2, reject) => {
    const fullArgs = [...YT_DLP_COMMAND.baseArgs, ...args];
    const proc = spawn(YT_DLP_COMMAND.command, fullArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
      reject(new Error("timeout"));
    }, timeoutMs);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code !== 0) {
        const err = new Error(`yt-dlp exited with code ${code}`);
        err.stderr = stderr;
        reject(err);
      } else {
        resolve2(stdout);
      }
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        return reject(new Error("yt-dlp not found. Install yt-dlp or set YT_DLP_PATH."));
      }
      reject(err);
    });
  });
}
function downloadWithSpawn(args, timeoutMs) {
  return new Promise((resolve2, reject) => {
    const fullArgs = [...YT_DLP_COMMAND.baseArgs, ...args];
    const proc = spawn(YT_DLP_COMMAND.command, fullArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
      reject(new Error("Download timed out"));
    }, timeoutMs);
    proc.stdout.on("data", () => {
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 5e4) {
        stderr = stderr.slice(-3e4);
      }
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      resolve2({ code: code || 0, stderr });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        return reject(new Error("yt-dlp not found. Install yt-dlp or set YT_DLP_PATH."));
      }
      reject(err);
    });
  });
}
async function registerRoutes(app2) {
  console.log(`Using yt-dlp command: ${YT_DLP_COMMAND.command}`);
  checkFfmpeg();
  fetchProxies().catch(() => {
  });
  runYtDlpAutoUpdate();
  setInterval(() => {
    runYtDlpAutoUpdate();
  }, 12 * 60 * 60 * 1e3);
  app2.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now(), proxies: proxyList.length });
  });
  app2.get("/api/health/deep", async (_req, res) => {
    const ytTestUrl = process.env.HEALTHCHECK_YT_URL;
    const igTestUrl = process.env.HEALTHCHECK_IG_URL;
    const checks = {};
    try {
      if (ytTestUrl) {
        const cleanYt = normalizeUrl(sanitizeUrl(ytTestUrl));
        const ytOut = await analyzeWithTimeout(
          ["--get-id", "--no-playlist", "--no-warnings", cleanYt],
          2e4
        );
        checks.youtube = ytOut.trim() ? "ok" : "failed";
      }
      if (igTestUrl) {
        const cleanIg = normalizeUrl(sanitizeUrl(igTestUrl));
        const igOut = await analyzeWithTimeout(
          ["--get-id", "--no-playlist", "--no-warnings", "--impersonate", "Chrome", cleanIg],
          2e4
        );
        checks.instagram = igOut.trim() ? "ok" : "failed";
      }
      return res.json({
        status: "ok",
        timestamp: Date.now(),
        proxies: proxyList.length,
        checks
      });
    } catch (error) {
      return res.status(503).json({
        status: "degraded",
        timestamp: Date.now(),
        checks,
        error: error?.message || "health check failed"
      });
    }
  });
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
      const cleanUrl = normalizeUrl(sanitizeUrl(url));
      if (!isValidUrl(cleanUrl)) {
        return res.status(400).json({ error: "Invalid URL provided" });
      }
      if (!isAllowedHost(cleanUrl)) {
        return res.status(400).json({ error: "Unsupported platform. Supported: YouTube, Facebook, Instagram, Twitter/X, Vimeo, Dailymotion, Reddit, and more" });
      }
      const cached = analysisCache.get(cleanUrl);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return res.json(cached.data);
      }
      const platform = detectPlatform(cleanUrl);
      const platformNeedsProxy = false;
      console.log("Analyzing:", cleanUrl, `(platform: ${platform})`);
      const startTime = Date.now();
      let stdout = "";
      try {
        stdout = await runAnalyzeStrategies(platform, cleanUrl);
      } catch (directErr) {
        const errMsg = (directErr.stderr || "").toLowerCase();
        const isBlocked = errMsg.includes("blocked") || errMsg.includes("forbidden") || errMsg.includes("403") || errMsg.includes("rate-limit");
        if (isBlocked || platformNeedsProxy) {
          console.log(`Direct access failed for ${platform}, trying with proxies...`);
          await fetchProxies();
          let proxySuccess = false;
          const maxProxyTries = Math.min(8, proxyList.length);
          for (let i = 0; i < maxProxyTries; i++) {
            const proxyUrl = getNextProxy();
            if (!proxyUrl) break;
            try {
              console.log(`Proxy attempt ${i + 1}/${maxProxyTries}: ${proxyUrl}`);
              const proxiedArgs = [
                "--dump-json",
                "--no-download",
                "--no-playlist",
                "--no-warnings",
                "--no-check-certificates",
                "--no-check-formats",
                "--skip-download",
                "--socket-timeout",
                "15",
                "--retries",
                "2",
                "--proxy",
                proxyUrl,
                ...["Instagram", "Twitter/X", "Video"].includes(platform) ? ["--impersonate", "Chrome"] : [],
                ...getCookiesArgs(),
                cleanUrl
              ];
              stdout = await analyzeWithTimeout(proxiedArgs, 3e4);
              console.log(`Proxy ${proxyUrl} worked!`);
              proxySuccess = true;
              break;
            } catch (proxyErr) {
              console.log(`Proxy ${proxyUrl} failed: ${(proxyErr.message || "").slice(0, 80)}`);
              markProxyBad(proxyUrl);
            }
          }
          if (!proxySuccess) {
            throw directErr;
          }
        } else {
          throw directErr;
        }
      }
      const elapsed = ((Date.now() - startTime) / 1e3).toFixed(1);
      console.log(`Analyze completed in ${elapsed}s`);
      const rawInfo = JSON.parse(stdout);
      const formats = parseFormats(rawInfo.formats);
      const isYouTube = platform === "Video";
      let directUrl;
      let needsServerDownload = isYouTube;
      if (!isYouTube && rawInfo.formats && Array.isArray(rawInfo.formats)) {
        const combinedFormats = rawInfo.formats.filter((f) => {
          const hasVideo = f.vcodec && f.vcodec !== "none";
          const hasAudio = f.acodec && f.acodec !== "none";
          const hasUrl = f.url && f.url.startsWith("http");
          return hasVideo && hasAudio && hasUrl;
        }).sort((a, b) => (b.height || 0) - (a.height || 0));
        if (combinedFormats.length > 0) {
          const best = combinedFormats.find((f) => f.ext === "mp4" || f.vcodec?.startsWith("avc")) || combinedFormats[0];
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
      const cleanFormats = formats.map((f) => {
        const { url: _url, ...rest } = f;
        return rest;
      });
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
        formats: cleanFormats,
        platform,
        directUrl,
        needsServerDownload
      };
      analysisCache.set(cleanUrl, { data: videoInfo, timestamp: Date.now() });
      return res.json(videoInfo);
    } catch (error) {
      console.error("Analyze error:", error.message);
      console.error("Analyze stderr:", error.stderr || "none");
      if (error.message?.includes("timeout")) {
        return res.status(504).json({ error: "Analysis timed out. Try a shorter video or different URL." });
      }
      const mapped = mapYtDlpError(error.stderr || error.message || "");
      return res.status(mapped.status).json({ error: mapped.message, bucket: mapped.bucket });
    }
  });
  let activeDownloads = 0;
  const MAX_CONCURRENT_DOWNLOADS = 2;
  app2.post("/api/download", async (req, res) => {
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
        const cleanUrl = normalizeUrl(sanitizeUrl(url));
        if (!isValidUrl(cleanUrl)) {
          return res.status(400).json({ error: "Invalid URL" });
        }
        if (!isAllowedHost(cleanUrl)) {
          return res.status(400).json({ error: "Unsupported platform" });
        }
        const hasFfmpeg = await checkFfmpeg();
        const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const dlPlatform = detectPlatform(cleanUrl);
        const ext = type === "audio" ? hasFfmpeg ? "mp3" : "m4a" : "mp4";
        const outputPath = type === "audio" ? path.join(TEMP_DIR, `${fileId}.${ext}`) : path.join(TEMP_DIR, `${fileId}.%(ext)s`);
        const downloadStrategies = buildDownloadStrategies({
          platform: dlPlatform,
          cleanUrl,
          outputPath,
          type,
          quality,
          hasFfmpeg
        });
        console.log("Download started:", cleanUrl);
        const startTime = Date.now();
        const downloadTimeout = 30 * 60 * 1e3;
        let result = null;
        for (let i = 0; i < downloadStrategies.length; i++) {
          if (BACKOFF_MS[i]) {
            await sleep(BACKOFF_MS[i]);
          }
          const current = await downloadWithSpawn(downloadStrategies[i], downloadTimeout);
          if (current.code === 0) {
            result = current;
            break;
          }
          result = current;
          console.log(`Download strategy ${i + 1} failed, trying fallback...`);
        }
        if (!result || result.code !== 0) {
          const mapped = mapYtDlpError(result?.stderr || "Download failed");
          return res.status(mapped.status).json({ error: mapped.message, bucket: mapped.bucket });
        }
        const elapsed = ((Date.now() - startTime) / 1e3).toFixed(1);
        console.log(`Download completed in ${elapsed}s`);
        const safeTitle = sanitizeFilename(title || "video");
        const actualFiles = fs.readdirSync(TEMP_DIR).filter((f) => f.startsWith(fileId));
        if (actualFiles.length === 0) {
          return res.status(500).json({ error: "Download failed - file not created" });
        }
        const actualFile = actualFiles[0];
        const actualExt = path.extname(actualFile).slice(1);
        const correctedFilename = `${safeTitle}.${actualExt}`;
        return res.json({
          fileId: actualFile,
          filename: correctedFilename,
          downloadPath: `/api/file/${actualFile}?name=${encodeURIComponent(correctedFilename)}`
        });
      } catch (error) {
        console.error("Download error:", error.message);
        if (error.message?.includes("timed out")) {
          return res.status(504).json({ error: "Download timed out. Video might be too long or slow." });
        }
        const mapped = mapYtDlpError(error.stderr || error.message || "");
        return res.status(mapped.status).json({ error: mapped.message, bucket: mapped.bucket });
      } finally {
        activeDownloads--;
        console.log(`Download slot freed. Active: ${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS}`);
      }
    } catch (outerError) {
      return res.status(500).json({ error: "Server error" });
    }
  });
  app2.get("/api/file/:fileId", (req, res) => {
    try {
      const { fileId } = req.params;
      const safeName = String(fileId).replace(/[^a-zA-Z0-9._-]/g, "");
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
      else if (ext === ".m4a") contentType = "audio/mp4";
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
  app2.post("/api/get-url", async (req, res) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(ip)) {
        return res.status(429).json({ error: "Too many requests" });
      }
      const { url, type, quality } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }
      const cleanUrl = normalizeUrl(sanitizeUrl(url));
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
        "--socket-timeout",
        "15",
        "--retries",
        "3",
        ...["Instagram", "Twitter/X"].includes(platform) ? ["--impersonate", "Chrome"] : [],
        ...getCookiesArgs(),
        "-f",
        "best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best",
        cleanUrl
      ];
      const stdout = await analyzeWithTimeout(args, 2e4);
      const urls = stdout.trim().split("\n").filter((u) => u.startsWith("http"));
      if (urls.length === 0) {
        return res.json({ error: "Direct URL not available", fallback: true });
      }
      if (urls.length === 1) {
        return res.json({ directUrl: urls[0], method: "direct" });
      }
      return res.json({ error: "Multiple streams detected, requires server merge", fallback: true });
    } catch (error) {
      console.error("Get-URL error:", error.stderr || error.message);
      return res.json({ error: "Direct URL not available", fallback: true });
    }
  });
  app2.get("/api/thumbnail", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "URL is required" });
      }
      const cleanUrl = normalizeUrl(sanitizeUrl(url));
      if (!isValidUrl(cleanUrl)) {
        return res.status(400).json({ error: "Invalid URL" });
      }
      const stdout = await analyzeWithTimeout([
        "--get-thumbnail",
        "--no-download",
        "--no-playlist",
        "--no-warnings",
        "--no-check-certificates",
        cleanUrl
      ], 15e3);
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
  server.listen(port, "0.0.0.0", () => {
    log(`express server serving on port ${port}`);
  });
})();
