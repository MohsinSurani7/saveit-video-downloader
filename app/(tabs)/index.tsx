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
import { useMutation } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useTheme } from "@/lib/useTheme";
import { VideoInfo, VideoFormat } from "@/lib/types";
import { addToHistory } from "@/lib/history";
import { URLInput } from "@/components/URLInput";
import { VideoPreview } from "@/components/VideoPreview";
import { FormatSelector } from "@/components/FormatSelector";
import { DownloadButton } from "@/components/DownloadButton";

type DownloadState = "idle" | "preparing" | "downloading" | "paused" | "saving";

export default function DownloadScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null);
  const [downloadType, setDownloadType] = useState<"video" | "audio">("video");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const downloadResumableRef = useRef<FileSystem.DownloadResumable | null>(null);
  const currentFilenameRef = useRef<string>("");
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);

  const analyzeMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await apiRequest("POST", "/api/analyze", { url });
      return (await res.json()) as VideoInfo;
    },
    onSuccess: (data) => {
      setVideoInfo(data);
      setSelectedFormat(null);
      setDownloadType("video");
      const firstVideo = data.formats.find((f) => f.type === "video");
      if (firstVideo) setSelectedFormat(firstVideo);
    },
    onError: (error: Error) => {
      Alert.alert("Error", error.message || "Failed to analyze video");
    },
  });

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

  const recordHistory = useCallback(async () => {
    if (videoInfo) {
      await addToHistory({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: videoInfo.title,
        thumbnail: videoInfo.thumbnail,
        platform: videoInfo.platform,
        quality: selectedFormat?.quality || "best",
        format: selectedFormat?.ext || (downloadType === "audio" ? "mp3" : "mp4"),
        timestamp: Date.now(),
        url: videoInfo.url,
      });
    }
  }, [videoInfo, selectedFormat, downloadType]);

  const startDownload = useCallback(async () => {
    if (!videoInfo) return;

    pausedRef.current = false;
    cancelledRef.current = false;
    setDownloadProgress(0);
    setDownloadState("preparing");

    try {
      if (Platform.OS === "web") {
        const res = await apiRequest("POST", "/api/download", {
          url: videoInfo.url,
          formatId: selectedFormat?.formatId,
          type: downloadType,
          title: videoInfo.title,
        });
        const data = (await res.json()) as {
          fileId: string;
          filename: string;
          downloadPath: string;
        };
        const baseUrl = getApiUrl();
        const fileUrl = new URL(data.downloadPath, baseUrl).toString();
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setDownloadState("idle");
        return;
      }

      if (cancelledRef.current) { setDownloadState("idle"); return; }

      const res = await apiRequest("POST", "/api/download", {
        url: videoInfo.url,
        type: downloadType,
        title: videoInfo.title,
        quality: selectedFormat?.quality,
      });
      const data = (await res.json()) as {
        fileId: string;
        filename: string;
        downloadPath: string;
      };

      if (cancelledRef.current) { setDownloadState("idle"); return; }

      const baseUrl = getApiUrl();
      const fileUrl = new URL(data.downloadPath, baseUrl).toString();
      const filename = data.filename;
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
        if (pausedRef.current || cancelledRef.current) {
          return;
        }
        throw e;
      }

      if (pausedRef.current) return;
      if (cancelledRef.current) { setDownloadState("idle"); return; }

      if (!result?.uri) {
        throw new Error("Download failed - no file received");
      }

      downloadResumableRef.current = null;
      setDownloadState("saving");

      await saveToGallery(result.uri, filename);
      await recordHistory();

      setDownloadState("idle");
      setDownloadProgress(0);
    } catch (error: any) {
      if (pausedRef.current || cancelledRef.current) return;
      downloadResumableRef.current = null;
      setDownloadState("idle");
      setDownloadProgress(0);
      Alert.alert("Error", error.message || "Failed to download");
    }
  }, [videoInfo, selectedFormat, downloadType, recordHistory]);

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

  const handleAnalyze = useCallback((url: string) => {
    setVideoInfo(null);
    setSelectedFormat(null);
    analyzeMutation.mutate(url);
  }, []);

  const handleTypeChange = useCallback(
    (type: "video" | "audio") => {
      setDownloadType(type);
      setSelectedFormat(null);
      if (videoInfo) {
        const first = videoInfo.formats.find((f) => f.type === type);
        if (first) setSelectedFormat(first);
      }
    },
    [videoInfo]
  );

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

        <URLInput onSubmit={handleAnalyze} isLoading={analyzeMutation.isPending} />

        {analyzeMutation.isPending && (
          <View style={[styles.loadingCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.shimmerRow}>
              <View style={[styles.shimmerBlock, styles.shimmerThumb, { backgroundColor: theme.surfaceSecondary }]} />
            </View>
            <View style={styles.shimmerRow}>
              <View style={[styles.shimmerBlock, styles.shimmerTitle, { backgroundColor: theme.surfaceSecondary }]} />
            </View>
            <View style={styles.shimmerRow}>
              <View style={[styles.shimmerBlock, styles.shimmerMeta, { backgroundColor: theme.surfaceSecondary }]} />
            </View>
          </View>
        )}

        {videoInfo && !analyzeMutation.isPending && (
          <>
            <VideoPreview video={videoInfo} />

            <FormatSelector
              formats={videoInfo.formats}
              selectedFormat={selectedFormat}
              onSelectFormat={setSelectedFormat}
              downloadType={downloadType}
              onChangeType={handleTypeChange}
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

            {!isDownloading && (
              <DownloadButton
                onPress={startDownload}
                isLoading={false}
                disabled={!selectedFormat && downloadType === "video"}
                label={
                  downloadType === "audio"
                    ? "Download Audio"
                    : "Download Video"
                }
              />
            )}
          </>
        )}

        {!videoInfo && !analyzeMutation.isPending && (
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
  loadingCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    overflow: "hidden",
  },
  shimmerRow: {
    overflow: "hidden",
  },
  shimmerBlock: {
    borderRadius: 8,
  },
  shimmerThumb: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 12,
  },
  shimmerTitle: {
    height: 20,
    width: "80%",
  },
  shimmerMeta: {
    height: 14,
    width: "50%",
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
