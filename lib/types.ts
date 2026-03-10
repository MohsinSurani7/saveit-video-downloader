export interface VideoFormat {
  formatId: string;
  ext: string;
  quality: string;
  resolution: string;
  filesize: number | null;
  vcodec: string;
  acodec: string;
  type: "video" | "audio";
  fps: number | null;
}

export interface VideoInfo {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: number;
  channel: string;
  viewCount: number;
  uploadDate: string;
  url: string;
  formats: VideoFormat[];
  platform: string;
  directUrl?: string;
  needsServerDownload?: boolean;
}

export interface DownloadHistoryItem {
  id: string;
  title: string;
  thumbnail: string;
  platform: string;
  quality: string;
  format: string;
  timestamp: number;
  url: string;
  localUri?: string;
}
