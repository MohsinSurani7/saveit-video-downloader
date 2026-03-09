import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/useTheme";
import { VideoInfo } from "@/lib/types";

interface VideoPreviewProps {
  video: VideoInfo;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatViewCount(count: number): string {
  if (!count) return "";
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M views`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K views`;
  return `${count} views`;
}

function getPlatformIcon(platform: string): string {
  switch (platform) {
    case "Video": return "videocam-outline";
    case "Facebook": return "logo-facebook";
    case "Instagram": return "logo-instagram";
    case "TikTok": return "logo-tiktok";
    case "Twitter/X": return "logo-twitter";
    case "Vimeo": return "logo-vimeo";
    default: return "globe-outline";
  }
}

function getPlatformColor(platform: string): string {
  switch (platform) {
    case "Video": return "#6366F1";
    case "Facebook": return "#1877F2";
    case "Instagram": return "#E4405F";
    case "TikTok": return "#000000";
    case "Twitter/X": return "#1DA1F2";
    case "Vimeo": return "#1AB7EA";
    default: return "#6B7280";
  }
}

export function VideoPreview({ video }: VideoPreviewProps) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.thumbnailContainer}>
        {video.thumbnail ? (
          <Image
            source={{ uri: video.thumbnail }}
            style={styles.thumbnail}
            contentFit="cover"
            transition={300}
          />
        ) : (
          <View style={[styles.thumbnail, styles.placeholderThumb, { backgroundColor: theme.surfaceSecondary }]}>
            <Ionicons name="videocam" size={40} color={theme.textSecondary} />
          </View>
        )}
        {video.duration > 0 && (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{formatDuration(video.duration)}</Text>
          </View>
        )}
      </View>
      <View style={styles.infoContainer}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
          {video.title}
        </Text>
        <View style={styles.metaRow}>
          <Ionicons
            name={getPlatformIcon(video.platform) as any}
            size={16}
            color={getPlatformColor(video.platform)}
          />
          <Text style={[styles.channel, { color: theme.textSecondary }]} numberOfLines={1}>
            {video.channel}
          </Text>
        </View>
        {video.viewCount > 0 && (
          <Text style={[styles.views, { color: theme.textSecondary }]}>
            {formatViewCount(video.viewCount)}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
  },
  thumbnailContainer: {
    position: "relative",
    width: "100%",
    aspectRatio: 16 / 9,
  },
  thumbnail: {
    width: "100%",
    height: "100%",
  },
  placeholderThumb: {
    alignItems: "center",
    justifyContent: "center",
  },
  durationBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.8)",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  durationText: {
    color: "#FFF",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  infoContainer: {
    padding: 14,
    gap: 6,
  },
  title: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  channel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  views: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
