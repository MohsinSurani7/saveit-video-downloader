import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/lib/useTheme";
import { VideoFormat } from "@/lib/types";

interface FormatSelectorProps {
  formats: VideoFormat[];
  selectedFormat: VideoFormat | null;
  onSelectFormat: (format: VideoFormat) => void;
  downloadType: "video" | "audio";
  onChangeType: (type: "video" | "audio") => void;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function FormatSelector({
  formats,
  selectedFormat,
  onSelectFormat,
  downloadType,
  onChangeType,
}: FormatSelectorProps) {
  const theme = useTheme();

  const filteredFormats = formats.filter((f) => f.type === downloadType);
  const uniqueFormats = filteredFormats.reduce((acc: VideoFormat[], f) => {
    const existing = acc.find((a) => a.quality === f.quality && a.ext === f.ext);
    if (!existing) acc.push(f);
    return acc;
  }, []);

  const handleTypeChange = (type: "video" | "audio") => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onChangeType(type);
  };

  const handleSelect = (format: VideoFormat) => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync();
    }
    onSelectFormat(format);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.typeToggle, { backgroundColor: theme.surfaceSecondary }]}>
        <Pressable
          onPress={() => handleTypeChange("video")}
          style={[
            styles.typeBtn,
            downloadType === "video" && {
              backgroundColor: theme.accent,
            },
          ]}
        >
          <Ionicons
            name="videocam"
            size={18}
            color={downloadType === "video" ? "#FFF" : theme.textSecondary}
          />
          <Text
            style={[
              styles.typeText,
              {
                color: downloadType === "video" ? "#FFF" : theme.textSecondary,
              },
            ]}
          >
            Video
          </Text>
        </Pressable>
        <Pressable
          onPress={() => handleTypeChange("audio")}
          style={[
            styles.typeBtn,
            downloadType === "audio" && {
              backgroundColor: theme.accent,
            },
          ]}
        >
          <Ionicons
            name="musical-notes"
            size={18}
            color={downloadType === "audio" ? "#FFF" : theme.textSecondary}
          />
          <Text
            style={[
              styles.typeText,
              {
                color: downloadType === "audio" ? "#FFF" : theme.textSecondary,
              },
            ]}
          >
            Audio
          </Text>
        </Pressable>
      </View>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
        Available Formats
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.formatList}
      >
        {uniqueFormats.length === 0 && (
          <Text style={[styles.noFormats, { color: theme.textSecondary }]}>
            No {downloadType} formats available
          </Text>
        )}
        {uniqueFormats.map((format) => {
          const isSelected =
            selectedFormat?.formatId === format.formatId;
          return (
            <Pressable
              key={format.formatId}
              onPress={() => handleSelect(format)}
              style={[
                styles.formatChip,
                {
                  backgroundColor: isSelected
                    ? theme.accentLight
                    : theme.surface,
                  borderColor: isSelected ? theme.accent : theme.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.formatQuality,
                  { color: isSelected ? theme.accent : theme.text },
                ]}
              >
                {format.quality}
              </Text>
              <Text
                style={[
                  styles.formatExt,
                  { color: isSelected ? theme.accent : theme.textSecondary },
                ]}
              >
                {format.ext.toUpperCase()}
              </Text>
              {format.filesize && (
                <Text
                  style={[
                    styles.formatSize,
                    { color: theme.textSecondary },
                  ]}
                >
                  {formatFileSize(format.filesize)}
                </Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  typeToggle: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 4,
  },
  typeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  typeText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  formatList: {
    gap: 8,
    paddingRight: 4,
  },
  formatChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    minWidth: 80,
    gap: 2,
  },
  formatQuality: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  formatExt: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  formatSize: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  noFormats: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingVertical: 8,
  },
});
