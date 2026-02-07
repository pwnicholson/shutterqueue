export type Privacy = "public" | "friends" | "family" | "friends_family" | "private";

export type QueueStatus = "pending" | "uploading" | "done" | "done_warn" | "failed";

export type ScheduleSettings = {
  intervalHours: number;
  schedulerOn: boolean;
  nextRunAt?: string | null;
  lastError?: string;
  timeWindowEnabled: boolean;
  windowStart: string; // "HH:MM"
  windowEnd: string;   // "HH:MM"
  daysEnabled: boolean;
  allowedDays: number[]; // 0=Sun..6=Sat
  resumeOnLaunch: boolean;
};

export type QueueItem = {
  id: string;
  photoPath: string;
  title: string;
  description: string;
  tags: string; // comma-separated in UI
  groupIds: string[];
  albumIds: string[];
  createAlbums: string[];
  privacy: Privacy;
  status: QueueStatus;
  lastError?: string;
  photoId?: string;
  uploadedAt?: string;
};

export type Group = { id: string; name: string };
export type Album = { id: string; title: string };
