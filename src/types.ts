export type Privacy = "public" | "friends" | "family" | "friends_family" | "private";

export type GeoPrivacy = "public" | "contacts" | "friends" | "family" | "friends_family" | "private";

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
  uploadBatchSize?: number;
  // UI display helpers (set by main process during an active upload batch run)
  batchRunActive?: boolean;
  batchRunStartedAt?: string | null;
  batchRunSize?: number | null;
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
  safetyLevel: 1 | 2 | 3; // Flickr safety_level: 1=safe,2=moderate,3=restricted
  // Geo location data
  latitude?: number;
  longitude?: number;
  accuracy?: number; // Flickr accuracy 1-16 (1=world, 16=street)
  geoPrivacy?: GeoPrivacy;
  locationDisplayName?: string;
  status: QueueStatus;
  lastError?: string;
  photoId?: string;
  uploadedAt?: string;
  scheduledUploadAt?: string;
  // Per-group add status after upload (for retry/backoff and user messaging)
  groupAddStates?: Record<string, {
    status: "pending" | "done" | "failed" | "retry" | "gave_up";
    message?: string;
    code?: number;
    retryCount?: number;
    firstFailedAt?: string;
    nextRetryAt?: string;
    lastAttemptAt?: string;
    retryPriority?: number;
  }>;
};

export type Group = { id: string; name: string; memberCount?: number; photoCount?: number };
export type Album = { id: string; title: string };
