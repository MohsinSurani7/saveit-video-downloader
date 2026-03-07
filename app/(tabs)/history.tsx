import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/lib/useTheme";
import { DownloadHistoryItem } from "@/lib/types";
import { getHistory, removeFromHistory, clearHistory } from "@/lib/history";
import { HistoryItem } from "@/components/HistoryItem";

export default function HistoryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const [history, setHistory] = useState<DownloadHistoryItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [])
  );

  const loadHistory = async () => {
    const items = await getHistory();
    setHistory(items);
  };

  const handleDelete = async (id: string) => {
    await removeFromHistory(id);
    setHistory((prev) => prev.filter((item) => item.id !== id));
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleClearAll = () => {
    Alert.alert(
      "Clear History",
      "Are you sure you want to clear all download history?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await clearHistory();
            setHistory([]);
            if (Platform.OS !== "web") {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success
              );
            }
          },
        },
      ]
    );
  };

  const renderItem = useCallback(
    ({ item }: { item: DownloadHistoryItem }) => (
      <HistoryItem item={item} onDelete={handleDelete} />
    ),
    []
  );

  const keyExtractor = useCallback(
    (item: DownloadHistoryItem) => item.id,
    []
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.headerBar,
          {
            paddingTop: insets.top + webTopInset + 16,
            borderBottomColor: theme.border,
          },
        ]}
      >
        <Text style={[styles.screenTitle, { color: theme.text }]}>History</Text>
        {history.length > 0 && (
          <Pressable onPress={handleClearAll} hitSlop={8}>
            <Ionicons name="trash-outline" size={22} color={theme.error} />
          </Pressable>
        )}
      </View>

      <FlatList
        data={history}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.listContent,
          history.length === 0 && styles.emptyList,
        ]}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        scrollEnabled={history.length > 0}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View
              style={[
                styles.emptyIconWrap,
                { backgroundColor: theme.surfaceSecondary },
              ]}
            >
              <Ionicons
                name="time-outline"
                size={36}
                color={theme.textSecondary}
              />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              No downloads yet
            </Text>
            <Text style={[styles.emptyDesc, { color: theme.textSecondary }]}>
              Your download history will appear here
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  screenTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  listContent: {
    padding: 16,
  },
  emptyList: {
    flex: 1,
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    gap: 12,
    paddingBottom: 60,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
  emptyDesc: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
