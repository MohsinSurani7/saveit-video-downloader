import React from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/lib/useTheme";

interface DownloadButtonProps {
  onPress: () => void;
  isLoading: boolean;
  disabled: boolean;
  label?: string;
}

export function DownloadButton({
  onPress,
  isLoading,
  disabled,
  label = "Download",
}: DownloadButtonProps) {
  const theme = useTheme();

  const handlePress = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || isLoading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor:
            disabled || isLoading ? theme.border : theme.success,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#FFF" />
          <Text style={styles.buttonText}>Processing...</Text>
        </View>
      ) : (
        <View style={styles.loadingRow}>
          <Ionicons name="download" size={22} color="#FFF" />
          <Text style={styles.buttonText}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonText: {
    color: "#FFF",
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
});
