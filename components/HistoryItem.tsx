import React from "react";
import { View, Text, Pressable, StyleSheet, Platform, Alert } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system/legacy";
import { useTheme } from "@/lib/useTheme";
import { DownloadHistoryItem } from "@/lib/types";

interface HistoryItemProps {
  item: DownloadHistoryItem;
  onDelete: (id: string) => void;
}

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function HistoryItem({ item, onDelete }: HistoryItemProps) {
  const theme = useTheme();

  const handleDelete = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onDelete(item.id);
  };

  const handlePlay = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    if (item.localUri) {
      if (Platform.OS !== "web") {
        try {
          const fileInfo = await FileSystem.getInfoAsync(item.localUri);
          if (fileInfo.exists) {
            router.push({
              pathname: "/player",
              params: { uri: item.localUri, title: item.title },
            });
            return;
          }
        } catch {}
        Alert.alert(
          "File Not Found",
          "The video file is no longer available on this device. Download it again to watch offline."
        );
        return;
      }

      router.push({
        pathname: "/player",
        params: { uri: item.localUri, title: item.title },
      });
      return;
    }

    Alert.alert(
      "File Not Available",
      "This video was downloaded before the player feature was added. Download it again to watch offline."
    );
  };

  return (
    <Pressable onPress={handlePlay} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
      <View
        style={[
          styles.container,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <View style={styles.thumbWrap}>
          {item.thumbnail ? (
            <View>
              <Image
                source={{ uri: item.thumbnail }}
                style={styles.thumb}
                contentFit="cover"
              />
              <View style={styles.playOverlay}>
                <Ionicons name="play" size={16} color="#FFF" />
              </View>
            </View>
          ) : (
            <View
              style={[
                styles.thumb,
                styles.placeholderThumb,
                { backgroundColor: theme.surfaceSecondary },
              ]}
            >
              <Ionicons name="videocam" size={20} color={theme.textSecondary} />
            </View>
          )}
        </View>
        <View style={styles.info}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.meta, { color: theme.textSecondary }]}>
              {item.platform}
            </Text>
            <View style={[styles.dot, { backgroundColor: theme.textSecondary }]} />
            <Text style={[styles.meta, { color: theme.textSecondary }]}>
              {item.quality} {item.format.toUpperCase()}
            </Text>
            <View style={[styles.dot, { backgroundColor: theme.textSecondary }]} />
            <Text style={[styles.meta, { color: theme.textSecondary }]}>
              {timeAgo(item.timestamp)}
            </Text>
          </View>
          {item.localUri && (
            <View style={styles.offlineBadge}>
              <Ionicons name="checkmark-circle" size={11} color={theme.success} />
              <Text style={[styles.offlineText, { color: theme.success }]}>
                Available offline
              </Text>
            </View>
          )}
        </View>
        <Pressable onPress={handleDelete} hitSlop={8} style={styles.deleteBtn}>
          <Ionicons name="close" size={20} color={theme.textSecondary} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  thumbWrap: {
    width: 56,
    height: 42,
    borderRadius: 8,
    overflow: "hidden",
  },
  thumb: {
    width: "100%",
    height: "100%",
  },
  placeholderThumb: {
    alignItems: "center",
    justifyContent: "center",
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  info: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  meta: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  offlineBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 1,
  },
  offlineText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
  },
  deleteBtn: {
    padding: 4,
  },
});
