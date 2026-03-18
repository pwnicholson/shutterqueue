import type { QueueItem, Group, Album } from "./types";

export {};

declare global {
  interface Window {
    sq: {
      getConfig: () => Promise<any>;
      setApiKeySecret: (apiKey: string, apiSecret: string) => Promise<any>;
      setUploadBatchSize: (uploadBatchSize: number) => Promise<any>;
      setSchedulerSettings: (payload: any) => Promise<any>;
      setSavedSets: (options: { kind: "group" | "album" | "tag"; sets: Array<{ name: string; ids: string[] }> }) => Promise<any>;
      startOAuth: () => Promise<any>;
      finishOAuth: (verifier: string) => Promise<any>;
      logout: () => Promise<any>;

      fetchGroups: (options?: { force?: boolean }) => Promise<Group[]>;
      fetchGroupRefreshStatus: () => Promise<{ inProgress: boolean; total: number; completed: number; startedAt: number }>;
      fetchAlbums: () => Promise<Album[]>;

      getThumbSrc: (photoPath: string) => Promise<string | null>;
      getPreviewSrc: (photoPath: string, maxEdge?: number) => Promise<string | null>;

      queueGet: () => Promise<QueueItem[]>;
      queueAdd: (paths: string[]) => Promise<QueueItem[]>;
      queueRemove: (ids: string[]) => Promise<QueueItem[]>;
      queueUpdate: (items: QueueItem[]) => Promise<QueueItem[]>;
      queueReorder: (idsInOrder: string[]) => Promise<QueueItem[]>;
      queueClearUploaded: () => Promise<QueueItem[]>;
      queueFindDuplicates: () => Promise<Array<{ hash: string; members: Array<{ id: string; photoPath: string; title?: string }>; removeCandidateIds: string[] }>>;
      queueExportToFile: () => Promise<{ ok: boolean; canceled?: boolean; error?: string; filePath?: string; itemCount?: number }>;
      queueImportFromFile: (mode: "append" | "replace") => Promise<{ ok: boolean; canceled?: boolean; error?: string; filePath?: string; itemCount?: number; skipped?: number; missingPaths?: number; previousCount?: number; importedCount?: number; mode?: "append" | "replace"; queue?: QueueItem[] }>;

      geoSearch: (query: string) => Promise<{ 
        ok: boolean; 
        results?: Array<{
          displayName: string;
          latitude: number;
          longitude: number;
          accuracy: number;
          type: string;
          address?: any;
        }>;
        error?: string;
      }>;

      uploadNowOne: (options?: { itemId?: string; reason?: string }) => Promise<any>;
      logGet: () => Promise<string[]>;
      logClear: () => Promise<any>;
      schedulerStart: (intervalHours: number, uploadImmediately: boolean, settings: any) => Promise<any>;
      showStartSchedulerDialog: () => Promise<"now" | "delay" | "cancel">;
      showQueueImportModeDialog: () => Promise<"replace" | "append" | "cancel">;
      showRetryUploadDialog: () => Promise<"retry_now" | "reset_status" | "cancel">;
      appVersion: () => Promise<string>;
      getFlickrPhotoUrls: (photoId: string) => Promise<{thumbUrl: string; previewUrl: string;}>
      schedulerStop: () => Promise<any>;
      schedulerStatus: () => Promise<any>;

      pickPhotos: () => Promise<string[]>;
      getPathForFile: (file: File) => string | null;
      openExternal: (options: { url: string }) => Promise<any>;
      setVerboseLogging: (enabled: boolean) => Promise<any>;
      setMinimizeToTray: (enabled: boolean) => Promise<any>;
      setCheckUpdatesOnLaunch: (enabled: boolean) => Promise<any>;
      checkForUpdates: (options?: { force?: boolean }) => Promise<{
        ok: boolean;
        checkedAt: number;
        currentVersion: string;
        latestVersion?: string;
        latestTag?: string;
        updateAvailable: boolean;
        releaseUrl?: string;
        releaseName?: string;
        publishedAt?: string;
        error?: string;
        cacheHit?: boolean;
        repoUrl?: string;
      }>;
      logSave: () => Promise<any>;
    };
    // custom event emitted from preload when an upload is in progress
    interface WindowEventMap {
      "sq-upload-progress": CustomEvent<{loaded:number; total:number}>;
      "sq-add-photos": CustomEvent<{paths:string[]}>;
    }
  }
}