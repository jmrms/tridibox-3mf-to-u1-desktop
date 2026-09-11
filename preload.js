'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  chooseFile: () => ipcRenderer.invoke('desktop:choose-file'),
  readFile: filePath => ipcRenderer.invoke('desktop:read-file', filePath),
  chooseWatchFolder: () => ipcRenderer.invoke('desktop:choose-watch-folder'),
  updateSettings: settings => ipcRenderer.invoke('desktop:update-settings', settings),
  saveConverted: payload => ipcRenderer.invoke('desktop:save-converted', payload),
  saveOriginal: payload => ipcRenderer.invoke('desktop:save-original', payload),
  openInOrca: filePath => ipcRenderer.invoke('desktop:open-in-orca', filePath),
  showInFolder: filePath => ipcRenderer.invoke('desktop:show-in-folder', filePath),
  getPathForFile: file => webUtils.getPathForFile(file),
  onFileOpened: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:file-opened', listener);
    return () => ipcRenderer.removeListener('desktop:file-opened', listener);
  },
  onFileError: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('desktop:file-error', listener);
    return () => ipcRenderer.removeListener('desktop:file-error', listener);
  },
  onWatchError: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('desktop:watch-error', listener);
    return () => ipcRenderer.removeListener('desktop:watch-error', listener);
  },
});
