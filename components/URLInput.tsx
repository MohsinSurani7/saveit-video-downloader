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

interface URLInputProps {
  onSubmit: (url: string) => void;
  onQuickDownload: (url: string) => void;
  isLoading: boolean;
  isQuickDownloading: boolean;
}

export function URLInput({ onSubmit, onQuickDownload, isLoading, isQuickDownloading }: URLInputProps) {
  const [url, setUrl] = useState("");
  const theme = useTheme();
  const busy = isLoading || isQuickDownloading;

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

  const handleSubmit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onSubmit(trimmed);
  };

  const handleQuickDownload = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    onQuickDownload(trimmed);
  };

  const handleClear = () => {
    setUrl("");
  };

  return (
    <View style={styles.outerContainer}>
      <View style={styles.container}>
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
            onSubmitEditing={handleSubmit}
            editable={!busy}
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
        <Pressable
          onPress={handleSubmit}
          disabled={busy || !url.trim()}
          style={({ pressed }) => [
            styles.submitBtn,
            {
              backgroundColor: busy || !url.trim()
                ? theme.border
                : theme.accent,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            },
          ]}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Ionicons name="search" size={22} color="#FFF" />
          )}
        </Pressable>
      </View>
      <Pressable
        onPress={handleQuickDownload}
        disabled={busy || !url.trim()}
        style={({ pressed }) => [
          styles.quickBtn,
          {
            backgroundColor: busy || !url.trim()
              ? theme.border
              : theme.success,
            opacity: pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          },
        ]}
      >
        {isQuickDownloading ? (
          <ActivityIndicator size="small" color="#FFF" />
        ) : (
          <>
            <Ionicons name="download" size={20} color="#FFF" />
            <Text style={styles.quickBtnText}>Quick Download</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    gap: 10,
  },
  container: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  inputRow: {
    flex: 1,
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
  submitBtn: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  quickBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 14,
  },
  quickBtnText: {
    color: "#FFF",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
