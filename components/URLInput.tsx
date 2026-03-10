import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/lib/useTheme";

export type QualityOption = "hd" | "sd" | "best";

interface URLInputProps {
  onQuickDownload: (url: string, quality: QualityOption) => void;
  isLoading: boolean;
  activeQuality: QualityOption | null;
}

export function URLInput({ onQuickDownload, isLoading, activeQuality }: URLInputProps) {
  const [url, setUrl] = useState("");
  const theme = useTheme();

  const handlePaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        setUrl(text);
        if (Platform.OS !== "web") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }
    } catch {}
  };

  const handleDownload = (quality: QualityOption) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    onQuickDownload(trimmed, quality);
  };

  const handleClear = () => {
    setUrl("");
  };

  const hasUrl = url.trim().length > 0;

  return (
    <View style={styles.outerContainer}>
      <View
        style={[
          styles.inputRow,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <Ionicons
          name="link"
          size={20}
          color={theme.textSecondary}
          style={styles.linkIcon}
        />
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder="Paste video URL here..."
          placeholderTextColor={theme.textSecondary}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => handleDownload("best")}
          editable={!isLoading}
          selectTextOnFocus
        />
        {url.length > 0 && (
          <Pressable onPress={handleClear} style={styles.iconBtn}>
            <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
          </Pressable>
        )}
        <Pressable onPress={handlePaste} style={styles.iconBtn}>
          <Ionicons name="clipboard-outline" size={20} color={theme.accent} />
        </Pressable>
      </View>
      <View style={styles.qualityRow}>
        {([
          { key: "hd" as QualityOption, label: "HD", icon: "sparkles" as const, color: "#6C5CE7" },
          { key: "sd" as QualityOption, label: "SD", icon: "flash" as const, color: "#00B894" },
          { key: "best" as QualityOption, label: "Best", icon: "diamond" as const, color: "#0984E3" },
        ]).map((opt) => {
          const isActive = activeQuality === opt.key;
          const disabled = isLoading || !hasUrl;
          return (
            <Pressable
              key={opt.key}
              onPress={() => handleDownload(opt.key)}
              disabled={disabled}
              style={({ pressed }) => [
                styles.qualityBtn,
                {
                  backgroundColor: disabled ? theme.border : isActive ? opt.color : theme.surface,
                  borderColor: disabled ? theme.border : opt.color,
                  opacity: pressed ? 0.85 : 1,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                },
              ]}
            >
              {isActive ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name={opt.icon} size={16} color={disabled ? theme.textSecondary : opt.color} />
                  <Text style={[styles.qualityText, { color: disabled ? theme.textSecondary : opt.color }]}>
                    {opt.label}
                  </Text>
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    gap: 12,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    height: 52,
  },
  linkIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    paddingVertical: 0,
  },
  iconBtn: {
    padding: 6,
  },
  qualityRow: {
    flexDirection: "row",
    gap: 10,
  },
  qualityBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 46,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  qualityText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
});
