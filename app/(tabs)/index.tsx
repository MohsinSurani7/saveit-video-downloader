import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useTheme } from "@/lib/useTheme";
import { VideoInfo, VideoFormat } from "@/lib/types";
import { addToHistory } from "@/lib/history";
import { URLInput } from "@/components/URLInput";
import { VideoPreview } from "@/components/VideoPreview";
import { FormatSelector } from "@/components/FormatSelector";
import { DownloadButton } from "@/components/DownloadButton";

export default function DownloadScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<VideoFormat | null>(null);
  const [downloadType, setDownloadType] = useState<"video" | "audio">("video");
  const [downloadProgress, setDownloadProgress] = useState(0);

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

  const downloadMutation = useMutation({
    mutationFn: async () => {
      if (!videoInfo) throw new Error("No video selected");

      setDownloadProgress(0);

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

      if (Platform.OS === "web") {
        const baseUrl = getApiUrl();
        const fileUrl = new URL(data.downloadPath, baseUrl).toString();
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return data;
      }

      const baseUrl = getApiUrl();
      const fileUrl = new URL(data.downloadPath, baseUrl).toString();
      const localUri = FileSystem.documentDirectory + data.filename;

      const downloadResumable = FileSystem.createDownloadResumable(
        fileUrl,
        localUri,
        {},
        (progress) => {
          const pct = progress.totalBytesWritten / progress.totalBytesExpectedToWrite;
          setDownloadProgress(Math.round(pct * 100));
        }
      );

      const result = await downloadResumable.downloadAsync();
      if (!result?.uri) throw new Error("Download failed");

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(result.uri, {
          mimeType: downloadType === "audio" ? "audio/mpeg" : "video/mp4",
          dialogTitle: "Save " + data.filename,
        });
      } else {
        Alert.alert("Downloaded", `${data.filename} saved successfully`);
      }

      return data;
    },
    onSuccess: async (data) => {
      setDownloadProgress(0);
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
    },
    onError: (error: Error) => {
      setDownloadProgress(0);
      Alert.alert("Error", error.message || "Failed to download");
    },
  });

  const handleAnalyze = useCallback((url: string) => {
    setVideoInfo(null);
    setSelectedFormat(null);
    analyzeMutation.mutate(url);
  }, []);

  const handleDownload = useCallback(() => {
    downloadMutation.mutate();
  }, [videoInfo, selectedFormat, downloadType]);

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

  const isDownloading = downloadMutation.isPending;

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

            {isDownloading && downloadProgress > 0 && (
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
                        backgroundColor: theme.success,
                        width: `${downloadProgress}%` as any,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.progressText, { color: theme.textSecondary }]}>
                  Downloading... {downloadProgress}%
                </Text>
              </View>
            )}

            <DownloadButton
              onPress={handleDownload}
              isLoading={isDownloading}
              disabled={!selectedFormat && downloadType === "video"}
              label={
                isDownloading && downloadProgress > 0
                  ? `${downloadProgress}%`
                  : downloadType === "audio"
                  ? "Download Audio"
                  : "Download Video"
              }
            />
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
              Supports YouTube, Facebook, Instagram, TikTok, Twitter, Vimeo, and more
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
    gap: 6,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
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
