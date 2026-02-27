import type { QueueItem, Group, Album } from "./types";

export {};

declare global {
  interface Window {
    sq: {
      getConfig: () => Promise<any>;
      setApiKeySecret: (apiKey: string, apiSecret: string) => Promise<any>;
      setUploadBatchSize: (uploadBatchSize: number) => Promise<any>;
      setSchedulerSettings: (payload: any) => Promise<any>;
      startOAuth: () => Promise<any>;
      finishOAuth: (verifier: string) => Promise<any>;
      logout: () => Promise<any>;

      fetchGroups: () => Promise<Group[]>;
      fetchAlbums: () => Promise<Album[]>;

      getThumbDataUrl: (photoPath: string) => Promise<string | null>;

      queueGet: () => Promise<QueueItem[]>;
      queueAdd: (paths: string[]) => Promise<QueueItem[]>;
      queueRemove: (ids: string[]) => Promise<QueueItem[]>;
      queueUpdate: (items: QueueItem[]) => Promise<QueueItem[]>;
      queueReorder: (idsInOrder: string[]) => Promise<QueueItem[]>;
      queueClearUploaded: () => Promise<QueueItem[]>;

      uploadNowOne: () => Promise<any>;
      logGet: () => Promise<string[]>;
      logClear: () => Promise<any>;
      schedulerStart: (intervalHours: number, uploadImmediately: boolean, settings: any) => Promise<any>;
      showStartSchedulerDialog: () => Promise<"now" | "delay" | "cancel">;
      schedulerStop: () => Promise<any>;
      schedulerStatus: () => Promise<any>;

      pickPhotos: () => Promise<string[]>;
    };
  }
}