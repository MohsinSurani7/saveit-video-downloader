import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  StatusBar,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function PlayerScreen() {
  const { uri, title } = useLocalSearchParams<{ uri: string; title: string }>();
  const insets = useSafeAreaInsets();

  const [showControls, setShowControls] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  const player = useVideoPlayer(uri || "", (p) => {
    p.loop = false;
    if (uri) p.play();
  });

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 4000);
  }, [isPlaying]);

  useEffect(() => {
    if (!player) return;

    const statusSub = player.addListener("statusChange", (payload: any) => {
      if (payload.status === "readyToPlay") {
        setIsLoading(false);
        setDuration(player.duration);
      } else if (payload.status === "loading") {
        setIsLoading(true);
      } else if (payload.status === "error") {
        setIsLoading(false);
        setError(payload.error?.message || "Failed to play video");
      }
    });

    const playingSub = player.addListener("playingChange", (payload: any) => {
      setIsPlaying(payload.isPlaying);
      if (payload.isPlaying) {
        scheduleHide();
      }
    });

    const interval = setInterval(() => {
      if (player && player.currentTime != null) {
        setCurrentTime(player.currentTime);
        if (player.duration > 0) {
          setDuration(player.duration);
        }
      }
    }, 250);

    return () => {
      statusSub.remove();
      playingSub.remove();
      clearInterval(interval);
    };
  }, [player, scheduleHide]);

  const toggleControls = useCallback(() => {
    setShowControls((prev) => {
      if (!prev) {
        scheduleHide();
      }
      return !prev;
    });
  }, [scheduleHide]);

  const togglePlay = useCallback(() => {
    if (!player) return;
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
    scheduleHide();
  }, [player, isPlaying, scheduleHide]);

  const seekRelative = useCallback(
    (seconds: number) => {
      if (!player) return;
      const newTime = Math.max(0, Math.min(duration, currentTime + seconds));
      player.currentTime = newTime;
      setCurrentTime(newTime);
      scheduleHide();
    },
    [player, currentTime, duration, scheduleHide]
  );

  const seekToPosition = useCallback(
    (locationX: number, layoutWidth: number) => {
      if (!player || duration <= 0) return;
      const ratio = Math.max(0, Math.min(1, locationX / layoutWidth));
      const newTime = ratio * duration;
      player.currentTime = newTime;
      setCurrentTime(newTime);
      scheduleHide();
    },
    [player, duration, scheduleHide]
  );

  const cycleSpeed = useCallback(() => {
    if (!player) return;
    const currentIdx = speeds.indexOf(playbackSpeed);
    const nextIdx = (currentIdx + 1) % speeds.length;
    const newSpeed = speeds[nextIdx];
    player.playbackRate = newSpeed;
    setPlaybackSpeed(newSpeed);
    scheduleHide();
  }, [player, playbackSpeed, scheduleHide]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (!uri) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={48} color="#EF4444" />
        <Text style={styles.errorText}>No video file found</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      <Pressable style={styles.videoContainer} onPress={toggleControls}>
        <VideoView
          player={player}
          style={styles.video}
          nativeControls={false}
          contentFit="contain"
        />
      </Pressable>

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      )}

      {error && (
        <View style={styles.loadingOverlay}>
          <Ionicons name="alert-circle" size={48} color="#EF4444" />
          <Text style={styles.errorOverlayText}>{error}</Text>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </Pressable>
        </View>
      )}

      {showControls && !error && (
        <View style={styles.controlsOverlay} pointerEvents="box-none">
          <View
            style={[
              styles.topBar,
              { paddingTop: Platform.OS === "web" ? 16 : insets.top + 8 },
            ]}
          >
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.topBtn}>
              <Ionicons name="chevron-back" size={28} color="#FFF" />
            </Pressable>
            <View style={styles.titleWrap}>
              <Text style={styles.playerTitle} numberOfLines={1}>
                {title || "Video"}
              </Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.centerControls}>
            <Pressable onPress={() => seekRelative(-10)} hitSlop={16} style={styles.seekBtn}>
              <Ionicons name="play-back" size={28} color="#FFF" />
              <Text style={styles.seekLabel}>10</Text>
            </Pressable>

            <Pressable onPress={togglePlay} style={styles.playPauseBtn}>
              <Ionicons
                name={isPlaying ? "pause" : "play"}
                size={40}
                color="#FFF"
              />
            </Pressable>

            <Pressable onPress={() => seekRelative(10)} hitSlop={16} style={styles.seekBtn}>
              <Ionicons name="play-forward" size={28} color="#FFF" />
              <Text style={styles.seekLabel}>10</Text>
            </Pressable>
          </View>

          <View
            style={[
              styles.bottomBar,
              { paddingBottom: Platform.OS === "web" ? 16 : insets.bottom + 8 },
            ]}
          >
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
              <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>

            <Pressable
              style={styles.progressBar}
              onPress={(e) => {
                const layoutWidth = SCREEN_WIDTH - 40;
                seekToPosition(e.nativeEvent.locationX, layoutWidth);
              }}
            >
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${progress}%` as any }]}
                />
                <View
                  style={[
                    styles.progressThumb,
                    { left: `${progress}%` as any },
                  ]}
                />
              </View>
            </Pressable>

            <View style={styles.bottomActions}>
              <Pressable onPress={cycleSpeed} style={styles.speedBtn}>
                <Text style={styles.speedText}>{playbackSpeed}x</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  videoContainer: {
    flex: 1,
  },
  video: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    gap: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
    gap: 16,
  },
  errorText: {
    color: "#FFF",
    fontSize: 16,
    fontFamily: "Inter_500Medium",
  },
  errorOverlayText: {
    color: "#FFF",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 40,
  },
  backBtn: {
    backgroundColor: "#333",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  backBtnText: {
    color: "#FFF",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  topBtn: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  titleWrap: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 8,
  },
  playerTitle: {
    color: "#FFF",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  centerControls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 48,
  },
  seekBtn: {
    alignItems: "center",
    justifyContent: "center",
    width: 56,
    height: 56,
  },
  seekLabel: {
    color: "#FFF",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    marginTop: -4,
  },
  playPauseBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
    gap: 8,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  timeText: {
    color: "#FFF",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  progressBar: {
    height: 32,
    justifyContent: "center",
  },
  progressTrack: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 2,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#3B82F6",
    borderRadius: 2,
  },
  progressThumb: {
    position: "absolute",
    top: -5,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#3B82F6",
    marginLeft: -7,
  },
  bottomActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  speedBtn: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  speedText: {
    color: "#FFF",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
