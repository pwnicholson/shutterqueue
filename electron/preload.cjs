const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("sq", {
  getConfig: () => ipcRenderer.invoke("cfg:get"),
  setApiKeySecret: (apiKey, apiSecret) => ipcRenderer.invoke("cfg:setKeys", { apiKey, apiSecret }),
  setTumblrKeySecret: (consumerKey, consumerSecret) => ipcRenderer.invoke("cfg:setTumblrKeys", { consumerKey, consumerSecret }),
  setUploadBatchSize: (uploadBatchSize) => ipcRenderer.invoke("cfg:setUploadBatchSize", { uploadBatchSize }),
  setSchedulerSettings: (payload) => ipcRenderer.invoke("cfg:setSchedulerSettings", payload),
  setSavedSets: (options) => ipcRenderer.invoke("cfg:setSavedSets", options),
  startOAuth: () => ipcRenderer.invoke("oauth:start"),
  finishOAuth: (verifier) => ipcRenderer.invoke("oauth:finish", { verifier }),
  logout: () => ipcRenderer.invoke("oauth:logout"),
  startTumblrOAuth: () => ipcRenderer.invoke("tumblr:oauth:start"),
  finishTumblrOAuth: (verifier) => ipcRenderer.invoke("tumblr:oauth:finish", { verifier }),
  tumblrLogout: () => ipcRenderer.invoke("tumblr:oauth:logout"),
  fetchTumblrBlogs: (options) => ipcRenderer.invoke("tumblr:blogs", options || {}),
  setTumblrPrimaryBlog: (blogId) => ipcRenderer.invoke("tumblr:setPrimaryBlog", { blogId }),

  fetchGroups: (options) => ipcRenderer.invoke("flickr:groups", options || {}),
  fetchGroupRefreshStatus: () => ipcRenderer.invoke("flickr:groupsRefreshStatus"),
  fetchAlbums: () => ipcRenderer.invoke("flickr:albums"),
  getFlickrPhotoUrls: (photoId) => ipcRenderer.invoke("flickr:photoUrls", { photoId }),

  getThumbSrc: (photoPath) => ipcRenderer.invoke("thumb:getSrc", { photoPath }),
  getPreviewSrc: (photoPath, maxEdge) => ipcRenderer.invoke("image:getPreviewSrc", { photoPath, maxEdge }),

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
