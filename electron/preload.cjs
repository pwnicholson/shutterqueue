const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("sq", {
  getConfig: () => ipcRenderer.invoke("cfg:get"),
  setApiKeySecret: (apiKey, apiSecret) => ipcRenderer.invoke("cfg:setKeys", { apiKey, apiSecret }),
  setTumblrKeySecret: (consumerKey, consumerSecret) => ipcRenderer.invoke("cfg:setTumblrKeys", { consumerKey, consumerSecret }),
  setBlueskyCredentials: (identifier, appPassword) => ipcRenderer.invoke("cfg:setBlueskyCredentials", { identifier, appPassword }),
  setPixelfedCredentials: (instanceUrl, accessToken) => ipcRenderer.invoke("cfg:setPixelfedCredentials", { instanceUrl, accessToken }),
  setMastodonCredentials: (instanceUrl, accessToken) => ipcRenderer.invoke("cfg:setMastodonCredentials", { instanceUrl, accessToken }),
  setUploadBatchSize: (uploadBatchSize) => ipcRenderer.invoke("cfg:setUploadBatchSize", { uploadBatchSize }),
  setSchedulerSettings: (payload) => ipcRenderer.invoke("cfg:setSchedulerSettings", payload),
  setSavedSets: (options) => ipcRenderer.invoke("cfg:setSavedSets", options),
  startOAuth: () => ipcRenderer.invoke("oauth:start"),
  finishOAuth: (verifier) => ipcRenderer.invoke("oauth:finish", { verifier }),
  logout: () => ipcRenderer.invoke("oauth:logout"),
  startTumblrOAuth: () => ipcRenderer.invoke("tumblr:oauth:start"),
  consumeTumblrOAuthVerifier: () => ipcRenderer.invoke("tumblr:oauth:consumeVerifier"),
  finishTumblrOAuth: (verifier) => ipcRenderer.invoke("tumblr:oauth:finish", { verifier }),
  tumblrLogout: () => ipcRenderer.invoke("tumblr:oauth:logout"),
  fetchTumblrBlogs: (options) => ipcRenderer.invoke("tumblr:blogs", options || {}),
  setTumblrPrimaryBlog: (blogId) => ipcRenderer.invoke("tumblr:setPrimaryBlog", { blogId }),
  startBlueskyAuth: () => ipcRenderer.invoke("bluesky:auth:start"),
  blueskyLogout: () => ipcRenderer.invoke("bluesky:auth:logout"),
  testPixelfedAuth: () => ipcRenderer.invoke("pixelfed:auth:test"),
  pixelfedLogout: () => ipcRenderer.invoke("pixelfed:auth:logout"),
  startPixelfedOAuth: (instanceUrl) => ipcRenderer.invoke("pixelfed:oauth:start", { instanceUrl }),
  completePixelfedOAuth: () => ipcRenderer.invoke("pixelfed:oauth:complete"),
  cancelPixelfedOAuth: () => ipcRenderer.invoke("pixelfed:oauth:cancel"),
  testMastodonAuth: () => ipcRenderer.invoke("mastodon:auth:test"),
  mastodonLogout: () => ipcRenderer.invoke("mastodon:auth:logout"),

  fetchGroups: (options) => ipcRenderer.invoke("flickr:groups", options || {}),
  fetchGroupRefreshStatus: () => ipcRenderer.invoke("flickr:groupsRefreshStatus"),
  fetchAlbums: () => ipcRenderer.invoke("flickr:albums"),
  getFlickrPhotoUrls: (photoId) => ipcRenderer.invoke("flickr:photoUrls", { photoId }),

  getThumbSrc: (photoPath, variant) => ipcRenderer.invoke("thumb:getSrc", { photoPath, variant }),
  getPreviewSrc: (photoPath, maxEdge) => ipcRenderer.invoke("image:getPreviewSrc", { photoPath, maxEdge }),
  clearImageCache: () => ipcRenderer.invoke("cache:clearImageCache"),

  queueGet: () => ipcRenderer.invoke("queue:get"),
  queueAdd: (paths) => ipcRenderer.invoke("queue:add", { paths }),
  queueRemove: (ids) => ipcRenderer.invoke("queue:remove", { ids }),
  queueUpdate: (items) => ipcRenderer.invoke("queue:update", { items }),
  queueReorder: (idsInOrder) => ipcRenderer.invoke("queue:reorder", { idsInOrder }),
  queueClearUploaded: () => ipcRenderer.invoke("queue:clearUploaded"),
  queueFindDuplicates: () => ipcRenderer.invoke("queue:findDuplicates"),
  queueExportToFile: () => ipcRenderer.invoke("queue:exportToFile"),
  queueImportFromFile: (mode) => ipcRenderer.invoke("queue:importFromFile", { mode }),

  geoSearch: (query) => ipcRenderer.invoke("geo:search", { query }),

  uploadNowOne: (options) => ipcRenderer.invoke("upload:nowOne", options),
  schedulerStart: (intervalHours, uploadImmediately, settings) =>
    ipcRenderer.invoke("sched:start", { intervalHours, uploadImmediately, settings }),
  schedulerStop: () => ipcRenderer.invoke("sched:stop"),
  schedulerStatus: () => ipcRenderer.invoke("sched:status"),

  pickPhotos: () => ipcRenderer.invoke("ui:pickPhotos"),
  showStartSchedulerDialog: () => ipcRenderer.invoke("ui:show-start-scheduler-dialog"),
  showQueueImportModeDialog: () => ipcRenderer.invoke("ui:show-queue-import-mode-dialog"),
  showRetryUploadDialog: () => ipcRenderer.invoke("ui:show-retry-upload-dialog"),
  getPathForFile: (file) => {
    // Use Electron's webUtils to safely get the file system path from a File object
    try {
      return webUtils.getPathForFile(file);
    } catch (e) {
      console.error("Failed to get path for file:", e);
      return null;
    }
  },
  logGet: () => ipcRenderer.invoke("log:get"),
  logClear: () => ipcRenderer.invoke("log:clear"),
  setVerboseLogging: (enabled) => ipcRenderer.invoke("cfg:setVerboseLogging", { enabled }),
  setMinimizeToTray: (enabled) => ipcRenderer.invoke("cfg:setMinimizeToTray", { enabled }),
  setCheckUpdatesOnLaunch: (enabled) => ipcRenderer.invoke("cfg:setCheckUpdatesOnLaunch", { enabled }),
  setUseLargeThumbnails: (enabled) => ipcRenderer.invoke("cfg:setUseLargeThumbnails", { enabled }),
  setTumblrPostTextMode: (mode) => ipcRenderer.invoke("cfg:setTumblrPostTextMode", { mode }),
  setTumblrPostTimingMode: (mode) => ipcRenderer.invoke("cfg:setTumblrPostTimingMode", { mode }),
  setBlueskyPostTextMode: (mode) => ipcRenderer.invoke("cfg:setBlueskyPostTextMode", { mode }),
  setBlueskyLongPostMode: (mode) => ipcRenderer.invoke("cfg:setBlueskyLongPostMode", { mode }),
  setTumblrUseDescriptionAsImageDescription: (enabled) => ipcRenderer.invoke("cfg:setTumblrUseDescriptionAsImageDescription", { enabled }),
  setBlueskyUseDescriptionAsAltText: (enabled) => ipcRenderer.invoke("cfg:setBlueskyUseDescriptionAsAltText", { enabled }),
  setPixelfedPostTextMode: (mode) => ipcRenderer.invoke("cfg:setPixelfedPostTextMode", { mode }),
  setPixelfedUseDescriptionAsAltText: (enabled) => ipcRenderer.invoke("cfg:setPixelfedUseDescriptionAsAltText", { enabled }),
  setMastodonPostTextMode: (mode) => ipcRenderer.invoke("cfg:setMastodonPostTextMode", { mode }),
  setMastodonUseDescriptionAsAltText: (enabled) => ipcRenderer.invoke("cfg:setMastodonUseDescriptionAsAltText", { enabled }),
  setBlueskyPrependText: (text) => ipcRenderer.invoke("cfg:setBlueskyPrependText", { text }),
  setBlueskyAppendText: (text) => ipcRenderer.invoke("cfg:setBlueskyAppendText", { text }),
  setMastodonPrependText: (text) => ipcRenderer.invoke("cfg:setMastodonPrependText", { text }),
  setMastodonAppendText: (text) => ipcRenderer.invoke("cfg:setMastodonAppendText", { text }),
  setPixelfedPrependText: (text) => ipcRenderer.invoke("cfg:setPixelfedPrependText", { text }),
  setPixelfedAppendText: (text) => ipcRenderer.invoke("cfg:setPixelfedAppendText", { text }),
  setTumblrPrependText: (text) => ipcRenderer.invoke("cfg:setTumblrPrependText", { text }),
  setTumblrAppendText: (text) => ipcRenderer.invoke("cfg:setTumblrAppendText", { text }),
  setTumblrGlobalTags: (tags) => ipcRenderer.invoke("cfg:setTumblrGlobalTags", { tags }),
  setFlickrGlobalTags: (tags) => ipcRenderer.invoke("cfg:setFlickrGlobalTags", { tags }),
  setAddShutterQueueTagToAllUploads: (enabled) => ipcRenderer.invoke("cfg:setAddShutterQueueTagToAllUploads", { enabled }),
  clearLastError: () => ipcRenderer.invoke("cfg:clearLastError"),
  checkForUpdates: (options) => ipcRenderer.invoke("app:checkForUpdates", options || {}),
  logSave: () => ipcRenderer.invoke("log:save"),
  appVersion: () => ipcRenderer.invoke("app:version"),
  openExternal: (options) => ipcRenderer.invoke("shell:openExternal", options),

});

// Listen for files opened via command line or context menu
ipcRenderer.on("app:open-files", (_e, { paths }) => {
  window.dispatchEvent(new CustomEvent("sq-add-photos", { detail: { paths } }));
});

// re-dispatch upload progress events to the window so renderer can listen
ipcRenderer.on("upload:progress", (_e, data) => {
  window.dispatchEvent(new CustomEvent("sq-upload-progress", { detail: data }));
});

contextBridge.exposeInMainWorld("api",{ openThirdPartyLicenses: () => ipcRenderer.invoke("open-third-party-licenses") });
