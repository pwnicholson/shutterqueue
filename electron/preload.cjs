const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sq", {
  getConfig: () => ipcRenderer.invoke("cfg:get"),
  setApiKeySecret: (apiKey, apiSecret) => ipcRenderer.invoke("cfg:setKeys", { apiKey, apiSecret }),
  setUploadBatchSize: (uploadBatchSize) => ipcRenderer.invoke("cfg:setUploadBatchSize", { uploadBatchSize }),
  setSchedulerSettings: (payload) => ipcRenderer.invoke("cfg:setSchedulerSettings", payload),
  startOAuth: () => ipcRenderer.invoke("oauth:start"),
  finishOAuth: (verifier) => ipcRenderer.invoke("oauth:finish", { verifier }),
  logout: () => ipcRenderer.invoke("oauth:logout"),

  fetchGroups: () => ipcRenderer.invoke("flickr:groups"),
  fetchAlbums: () => ipcRenderer.invoke("flickr:albums"),
  getFlickrPhotoUrls: (photoId) => ipcRenderer.invoke("flickr:photoUrls", { photoId }),

  getThumbDataUrl: (photoPath) => ipcRenderer.invoke("thumb:getDataUrl", { photoPath }),

  queueGet: () => ipcRenderer.invoke("queue:get"),
  queueAdd: (paths) => ipcRenderer.invoke("queue:add", { paths }),
  queueRemove: (ids) => ipcRenderer.invoke("queue:remove", { ids }),
  queueUpdate: (items) => ipcRenderer.invoke("queue:update", { items }),
  queueReorder: (idsInOrder) => ipcRenderer.invoke("queue:reorder", { idsInOrder }),
  queueClearUploaded: () => ipcRenderer.invoke("queue:clearUploaded"),

  uploadNowOne: () => ipcRenderer.invoke("upload:nowOne"),
  schedulerStart: (intervalHours, uploadImmediately, settings) =>
    ipcRenderer.invoke("sched:start", { intervalHours, uploadImmediately, settings }),
  schedulerStop: () => ipcRenderer.invoke("sched:stop"),
  schedulerStatus: () => ipcRenderer.invoke("sched:status"),

  pickPhotos: () => ipcRenderer.invoke("ui:pickPhotos"),
  showStartSchedulerDialog: () => ipcRenderer.invoke("ui:show-start-scheduler-dialog"),
  logGet: () => ipcRenderer.invoke("log:get"),
  logClear: () => ipcRenderer.invoke("log:clear"),
  appVersion: () => ipcRenderer.invoke("app:version"),

});

// re-dispatch upload progress events to the window so renderer can listen
ipcRenderer.on("upload:progress", (_e, data) => {
  window.dispatchEvent(new CustomEvent("sq-upload-progress", { detail: data }));
});

contextBridge.exposeInMainWorld("api",{ openThirdPartyLicenses: () => ipcRenderer.invoke("open-third-party-licenses") });
