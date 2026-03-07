import AsyncStorage from "@react-native-async-storage/async-storage";
import { DownloadHistoryItem } from "@/lib/types";

const HISTORY_KEY = "download_history";

export async function getHistory(): Promise<DownloadHistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function addToHistory(item: DownloadHistoryItem): Promise<void> {
  const history = await getHistory();
  history.unshift(item);
  const trimmed = history.slice(0, 50);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(HISTORY_KEY);
}

export async function removeFromHistory(id: string): Promise<void> {
  const history = await getHistory();
  const filtered = history.filter((item) => item.id !== id);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
}
