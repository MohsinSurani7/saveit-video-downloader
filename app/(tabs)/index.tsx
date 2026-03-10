import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useTheme } from "@/lib/useTheme";
import { VideoInfo, VideoFormat } from "@/lib/types";
import { addToHistory } from "@/lib/history";
import { URLInput, QualityOption } from "@/components/URLInput";
import { VideoPreview } from "@/components/VideoPreview";

type DownloadState = "idle" | "preparing" | "downloading" | "paused" | "saving";

export default function DownloadScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const downloadResumableRef = useRef<FileSystem.DownloadResumable | null>(null);
  const currentFilenameRef = useRef<string>("");
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);

  const [activeQuality, setActiveQuality] = useState<QualityOption | null>(null);

  const saveToGallery = async (uri: string, filename: string) => {
    if (Platform.OS !== "web") {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status === "granted") {
        await MediaLibrary.saveToLibraryAsync(uri);
        Alert.alert("Saved", `${filename} saved to your gallery`);
      } else {
        Alert.alert("Downloaded", `${filename} saved to app storage`);
      }
    }
  };

  const handlePause = useCallback(async () => {
    if (downloadResumableRef.current) {
      pausedRef.current = true;
      setDownloadState("paused");
      try {
        await downloadResumableRef.current.pauseAsync();
      } catch (e) {
        console.log("Pause completed");
      }
    }
  }, []);

  const handleResume = useCallback(async () => {
    if (downloadResumableRef.current) {
      pausedRef.current = false;
      setDownloadState("downloading");
      try {
        const result = await downloadResumableRef.current.resumeAsync();

        if (cancelledRef.current) {
          setDownloadState("idle");
          setDownloadProgress(0);
          downloadResumableRef.current = null;
          return;
        }

        if (!result?.uri) throw new Error("Resume failed");

        downloadResumableRef.current = null;
        setDownloadState("saving");

        await saveToGallery(result.uri, currentFilenameRef.current);
        await recordHistory();

        setDownloadState("idle");
        setDownloadProgress(0);
      } catch (e: any) {
        if (pausedRef.current || cancelledRef.current) return;
        setDownloadState("idle");
        setDownloadProgress(0);
        downloadResumableRef.current = null;
        Alert.alert("Error", e.message || "Resume failed");
      }
    }
  }, [recordHistory]);

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    pausedRef.current = false;
    if (downloadResumableRef.current) {
      downloadResumableRef.current.pauseAsync().catch(() => {});
      downloadResumableRef.current = null;
    }
    setDownloadState("idle");
    setDownloadProgress(0);
  }, []);

  const handleQuickDownload = useCallback(async (url: string, quality: QualityOption) => {
    setActiveQuality(quality);
    setVideoInfo(null);
    setSelectedFormat(null);
    setDownloadProgress(0);
    pausedRef.current = false;
    cancelledRef.current = false;
    setDownloadState("preparing");

    const qualityMap: Record<QualityOption, string> = { hd: "1080p", sd: "480p", best: "" };
    const qualityParam = qualityMap[quality];

    try {
      const analyzeRes = await apiRequest("POST", "/api/analyze", { url });
      const info = (await analyzeRes.json()) as VideoInfo;
      setVideoInfo(info);

      const targetFormat = quality === "hd"
        ? info.formats.find((f) => f.type === "video" && parseInt(f.quality) >= 720)
        : quality === "sd"
        ? info.formats.find((f) => f.type === "video" && parseInt(f.quality) <= 480)
        : info.formats.find((f) => f.type === "video");
      const selectedFmt = targetFormat || info.formats.find((f) => f.type === "video");
      if (selectedFmt) setSelectedFormat(selectedFmt);

      if (cancelledRef.current) { setDownloadState("idle"); setActiveQuality(null); return; }

      let fileUrl: string;
      let filename: string;
      const safeTitle = info.title.replace(/[^a-zA-Z0-9._\- ]/g, "_").slice(0, 100);

      if (Platform.OS === "web") {
        const res = await apiRequest("POST", "/api/download", {
          url: info.url,
          type: "video",
          title: info.title,
          quality: selectedFmt?.quality || qualityParam,
        });
        const data = (await res.json()) as { fileId: string; filename: string; downloadPath: string };
        const baseUrl = getApiUrl();
        const dlUrl = new URL(data.downloadPath, baseUrl).toString();
        const link = document.createElement("a");
        link.href = dlUrl;
        link.download = data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setDownloadState("idle");
        setActiveQuality(null);
        return;
      }

      if (info.directUrl && !info.needsServerDownload) {
        fileUrl = info.directUrl;
        filename = `${safeTitle}.mp4`;
      } else {
        const res = await apiRequest("POST", "/api/download", {
          url: info.url,
          type: "video",
          title: info.title,
          quality: selectedFmt?.quality || qualityParam,
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Download failed" }));
          throw new Error(errData.error || "Download failed");
        }
        const data = (await res.json()) as { fileId: string; filename: string; downloadPath: string };
        const baseUrl = getApiUrl();
        fileUrl = new URL(data.downloadPath, baseUrl).toString();
        filename = data.filename;
      }

      if (cancelledRef.current) { setDownloadState("idle"); setActiveQuality(null); return; }

      const localUri = FileSystem.documentDirectory + filename;
      currentFilenameRef.current = filename;
      setDownloadState("downloading");

      const downloadResumable = FileSystem.createDownloadResumable(
        fileUrl,
        localUri,
        {},
        (progress) => {
          if (progress.totalBytesExpectedToWrite > 0) {
            const pct = progress.totalBytesWritten / progress.totalBytesExpectedToWrite;
            setDownloadProgress(Math.round(pct * 100));
          }
        }
      );

      downloadResumableRef.current = downloadResumable;

      let result;
      try {
        result = await downloadResumable.downloadAsync();
      } catch (e: any) {
        if (pausedRef.current || cancelledRef.current) { setActiveQuality(null); return; }
        throw e;
      }

      if (pausedRef.current) { setActiveQuality(null); return; }
      if (cancelledRef.current) { setDownloadState("idle"); setActiveQuality(null); return; }

      if (!result?.uri) throw new Error("Download failed - no file received");

      downloadResumableRef.current = null;
      setDownloadState("saving");

      await saveToGallery(result.uri, filename);

      await addToHistory({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: info.title,
        thumbnail: info.thumbnail,
        platform: info.platform,
        quality: selectedFmt?.quality || quality,
        format: "mp4",
        timestamp: Date.now(),
        url: info.url,
      });

      setDownloadState("idle");
      setDownloadProgress(0);
    } catch (error: any) {
      if (pausedRef.current || cancelledRef.current) { setActiveQuality(null); return; }
      downloadResumableRef.current = null;
      setDownloadState("idle");
      setDownloadProgress(0);
      Alert.alert("Error", error.message || "Download failed");
    } finally {
      setActiveQuality(null);
    }
  }, []);

  const isDownloading = downloadState !== "idle";

  const getStatusText = () => {
    switch (downloadState) {
      case "preparing": return "Server is preparing your file...";
      case "downloading": return `Downloading... ${downloadProgress}%`;
      case "paused": return `Paused at ${downloadProgress}%`;
      case "saving": return "Saving to gallery...";
      default: return "";
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + webTopInset + 16, paddingBottom: 120 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={[styles.appTitle, { color: theme.text }]}>SaveIt</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Download videos from anywhere
          </Text>
        </View>

        <URLInput
          onQuickDownload={handleQuickDownload}
          isLoading={isDownloading}
          activeQuality={activeQuality}
        />

        {isDownloading && (
          <View style={styles.progressContainer}>
            <View
              style={[
                styles.progressBarBg,
                { backgroundColor: theme.surfaceSecondary },
              ]}
            >
              <View
                style={[
                  styles.progressBarFill,
                  {
                    backgroundColor: downloadState === "paused" ? theme.warning : theme.success,
                    width: `${downloadProgress}%` as any,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressText, { color: theme.textSecondary }]}>
              {getStatusText()}
            </Text>

            <View style={styles.controlRow}>
              {downloadState === "downloading" && (
                <Pressable onPress={handlePause} style={[styles.controlBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Ionicons name="pause" size={20} color={theme.accent} />
                  <Text style={[styles.controlText, { color: theme.accent }]}>Pause</Text>
                </Pressable>
              )}
              {downloadState === "paused" && (
                <Pressable onPress={handleResume} style={[styles.controlBtn, { backgroundColor: theme.accentLight, borderColor: theme.accent }]}>
                  <Ionicons name="play" size={20} color={theme.accent} />
                  <Text style={[styles.controlText, { color: theme.accent }]}>Resume</Text>
                </Pressable>
              )}
              {(downloadState === "downloading" || downloadState === "paused" || downloadState === "preparing") && (
                <Pressable onPress={handleCancel} style={[styles.controlBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Ionicons name="close" size={20} color={theme.error} />
                  <Text style={[styles.controlText, { color: theme.error }]}>Cancel</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {videoInfo && !isDownloading && (
          <VideoPreview video={videoInfo} />
        )}

        {!videoInfo && !isDownloading && (
          <View style={styles.emptyState}>
            <View
              style={[
                styles.emptyIcon,
                { backgroundColor: theme.accentLight },
              ]}
            >
              <Ionicons name="cloud-download-outline" size={36} color={theme.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              Paste a video link to get started
            </Text>
            <Text style={[styles.emptyDesc, { color: theme.textSecondary }]}>
              Supports Facebook, Instagram, TikTok, Twitter, Vimeo, and more
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    gap: 20,
  },
  header: {
    gap: 4,
    marginBottom: 4,
  },
  appTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  progressContainer: {
    gap: 8,
  },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 4,
  },
  progressText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  controlRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    marginTop: 4,
  },
  controlBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  controlText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 12,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  emptyDesc: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 20,
  },
});
