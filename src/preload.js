const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('drop', {
  getState: invoke('get-state'),
  setSetting: invoke('set-setting'),
  chooseSaveDir: invoke('choose-save-dir'),
  openSaveDir: invoke('open-save-dir'),
  pickOutbox: invoke('pick-outbox'),
  addOutbox: invoke('add-outbox'),
  removeOutbox: invoke('remove-outbox'),
  clearOutbox: invoke('clear-outbox'),
  removeHistory: invoke('remove-history'),
  clearHistory: invoke('clear-history'),
  openFile: invoke('open-file'),
  showInFolder: invoke('show-in-folder'),
  regenerateToken: invoke('regenerate-token'),
  copy: invoke('copy'),
  restartServer: invoke('restart-server'),
  win: {
    minimize: invoke('win-minimize'),
    maximize: invoke('win-maximize'),
    close: invoke('win-close'),
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  on: (channel, cb) => {
    const allowed = ['state', 'transfers', 'navigate', 'maximized'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});
