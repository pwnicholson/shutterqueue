import type { QueueItem, Group, Album } from "./types";

export {};

declare global {
  interface Window {
    sq: {
      getConfig: () => Promise<any>;
      setApiKeySecret: (apiKey: string, apiSecret: string) => Promise<any>;
      setTumblrKeySecret: (consumerKey: string, consumerSecret: string) => Promise<any>;
      setBlueskyCredentials: (identifier: string, appPassword: string) => Promise<any>;
      setPixelfedCredentials: (instanceUrl: string, accessToken: string) => Promise<any>;
      setMastodonCredentials: (instanceUrl: string, accessToken: string) => Promise<any>;
      setLemmyCredentials: (instanceUrl: string, accessToken: string) => Promise<any>;
      setUploadBatchSize: (uploadBatchSize: number) => Promise<any>;
      setSchedulerSettings: (payload: any) => Promise<any>;
      setSavedSets: (options: { kind: "group" | "album" | "tag" | "lemmy_community"; sets: Array<{ name: string; ids: string[] }> }) => Promise<any>;
      startOAuth: () => Promise<any>;
      finishOAuth: (verifier: string) => Promise<any>;
      logout: () => Promise<any>;
      startTumblrOAuth: () => Promise<any>;
      consumeTumblrOAuthVerifier: () => Promise<{ verifier: string; oauthToken?: string }>;
      finishTumblrOAuth: (verifier: string) => Promise<any>;
      tumblrLogout: () => Promise<any>;
      fetchTumblrBlogs: (options?: { force?: boolean }) => Promise<Array<{ id: string; name: string; title: string; url: string; primary?: boolean }>>;
      setTumblrPrimaryBlog: (blogId: string) => Promise<any>;
      startBlueskyAuth: () => Promise<any>;
      blueskyLogout: () => Promise<any>;
      testPixelfedAuth: () => Promise<any>;
      pixelfedLogout: () => Promise<any>;
      startPixelfedOAuth: (instanceUrl: string) => Promise<{ ok: boolean }>;
      completePixelfedOAuth: () => Promise<{ ok: boolean; username?: string }>;
      cancelPixelfedOAuth: () => Promise<{ ok: boolean }>;
      testMastodonAuth: () => Promise<any>;
      mastodonLogout: () => Promise<any>;
      testLemmyAuth: () => Promise<any>;
      lemmyLogout: () => Promise<any>;
      fetchLemmyCommunities: (options?: { force?: boolean }) => Promise<Array<{ id: string; name: string; title: string; actorId?: string; subscribers?: number }>>;
      fetchLemmyCommunityInfo: (communityId: string) => Promise<{
        id: string;
        name: string;
        title: string;
        actorId?: string;
        description?: string;
        subscribers?: number;
        posts?: number;
        removed?: boolean;
        deleted?: boolean;
        nsfw?: boolean;
        postingRestrictedToMods?: boolean;
        communityUrl?: string;
      }>;

      fetchGroups: (options?: { force?: boolean }) => Promise<Group[]>;
      fetchGroupRefreshStatus: () => Promise<{ inProgress: boolean; total: number; completed: number; startedAt: number }>;
      fetchGroupInfo: (groupId: string) => Promise<{
        memberCount: number;
        photoCount: number;
        description: string;
        rulesText: string;
        additionalInfo: string;
        adminBlast: string;
        groupUrl: string;
      }>;
      fetchAlbums: () => Promise<Album[]>;

      getThumbSrc: (photoPath: string, variant?: "square" | "wide") => Promise<string | null>;
      getPreviewSrc: (photoPath: string, maxEdge?: number) => Promise<string | null>;
      clearImageCache: () => Promise<{ ok: boolean; deletedFiles?: number; error?: string }>;

      queueGet: () => Promise<QueueItem[]>;
      queueAdd: (paths: string[]) => Promise<QueueItem[]>;
      queueRemove: (ids: string[]) => Promise<QueueItem[]>;
      queueDetachToGroupOnly: (ids: string[]) => Promise<QueueItem[]>;
      queueTrashOriginalsByIds: (ids: string[]) => Promise<{
        ok: boolean;
        movedCount: number;
        skippedMissing: number;
        failedCount: number;
        trashLabel: string;
      }>;
      queueRemoveAndTrash: (ids: string[]) => Promise<{
        ok: boolean;
        queue: QueueItem[];
        movedCount: number;
        skippedMissing: number;
        failedCount: number;
        trashLabel: string;
      }>;
      queueGetMissingPathGroups: () => Promise<{
        ok: boolean;
        groups: Array<{ expectedDir: string; ids: string[]; missingCount: number }>;
        totalMissing: number;
      }>;
      queueRelinkMissingFromFolder: (options: { folderPath: string; ids?: string[] }) => Promise<{
        ok: boolean;
        queue?: QueueItem[];
        folderPath?: string;
        candidates?: number;
        scannedMissing?: number;
        updatedCount?: number;
        unresolvedCount?: number;
        ambiguousCount?: number;
        error?: string;
      }>;
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
      pickFolder: () => Promise<string>;
      getPathForFile: (file: File) => string | null;
      openExternal: (options: { url: string }) => Promise<any>;
      setVerboseLogging: (enabled: boolean) => Promise<any>;
      setMinimizeToTray: (enabled: boolean) => Promise<any>;
      setCheckUpdatesOnLaunch: (enabled: boolean) => Promise<any>;
      setUseLargeThumbnails: (enabled: boolean) => Promise<any>;
      setUseLightTheme: (enabled: boolean) => Promise<any>;
      setTumblrPostTextMode: (mode: "bold_title_then_description" | "title_then_description" | "title_only" | "description_only") => Promise<any>;
      setTumblrPostTimingMode: (mode: "publish_now" | "add_to_queue") => Promise<any>;
      setBlueskyPostTextMode: (mode: "merge_title_description_tags" | "merge_title_description" | "merge_title_tags" | "merge_description_tags" | "title_only" | "description_only") => Promise<any>;
      setBlueskyLongPostMode: (mode: "truncate" | "thread") => Promise<any>;
      setBlueskyImageResizeOptions: (payload: { enabled: boolean; maxWidth?: number; maxHeight?: number }) => Promise<any>;
      setTumblrUseDescriptionAsImageDescription: (enabled: boolean) => Promise<any>;
      setBlueskyUseDescriptionAsAltText: (enabled: boolean) => Promise<any>;
      setPixelfedPostTextMode: (mode: "merge_title_description_tags" | "merge_title_description" | "merge_title_tags" | "merge_description_tags" | "title_only" | "description_only") => Promise<any>;
      setPixelfedImageResizeOptions: (payload: { enabled: boolean; maxWidth?: number; maxHeight?: number }) => Promise<any>;
      setPixelfedUseDescriptionAsAltText: (enabled: boolean) => Promise<any>;
      setMastodonPostTextMode: (mode: "merge_title_description_tags" | "merge_title_description" | "merge_title_tags" | "merge_description_tags" | "title_only" | "description_only") => Promise<any>;
      setMastodonImageResizeOptions: (payload: { enabled: boolean; maxWidth?: number; maxHeight?: number }) => Promise<any>;
      setMastodonUseDescriptionAsAltText: (enabled: boolean) => Promise<any>;
      setLemmyPostTextMode: (mode: "merge_title_description_tags" | "merge_title_description" | "merge_title_tags" | "merge_description_tags" | "title_only" | "description_only") => Promise<any>;
      setLemmyImageResizeOptions: (payload: { enabled: boolean; maxWidth?: number; maxHeight?: number }) => Promise<any>;
      setBlueskyPrependText: (text: string) => Promise<any>;
      setBlueskyAppendText: (text: string) => Promise<any>;
      setMastodonPrependText: (text: string) => Promise<any>;
      setMastodonAppendText: (text: string) => Promise<any>;
      setLemmyPrependText: (text: string) => Promise<any>;
      setLemmyAppendText: (text: string) => Promise<any>;
      setPixelfedPrependText: (text: string) => Promise<any>;
      setPixelfedAppendText: (text: string) => Promise<any>;
      setTumblrPrependText: (text: string) => Promise<any>;
      setTumblrAppendText: (text: string) => Promise<any>;
      setTumblrGlobalTags: (tags: string) => Promise<any>;
      setFlickrGlobalTags: (tags: string) => Promise<any>;
      setAddShutterQueueTagToAllUploads: (enabled: boolean) => Promise<any>;
      clearLastError: () => Promise<any>;
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
  }
  // custom event emitted from preload when an upload is in progress
  interface WindowEventMap {
    "sq-upload-progress": CustomEvent<{ loaded: number; total: number }>;
    "sq-add-photos": CustomEvent<{ paths: string[] }>;
  }
}