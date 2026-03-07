import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.thumbWrap}>
        {item.thumbnail ? (
          <Image
            source={{ uri: item.thumbnail }}
            style={styles.thumb}
            contentFit="cover"
          />
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
      </View>
      <Pressable onPress={handleDelete} hitSlop={8}>
        <Ionicons name="close" size={20} color={theme.textSecondary} />
      </Pressable>
    </View>
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
});
