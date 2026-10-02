const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('gamehub', {
  getState: () => ipcRenderer.invoke('state:get'),
  scan: () => ipcRenderer.invoke('library:scan'),
  listGames: (consoleId) => ipcRenderer.invoke('library:list', consoleId),
  toggleFavorite: (romPath) => ipcRenderer.invoke('library:favorite', romPath),
  resolveArtwork: (consoleId, fileNames) => ipcRenderer.invoke('artwork:resolve', consoleId, fileNames),
  heroArtwork: (title) => ipcRenderer.invoke('artwork:hero', title),
  consolePhotos: () => ipcRenderer.invoke('artwork:consolePhotos'),
  listPcGames: () => ipcRenderer.invoke('pc:list'),
  addPcGame: () => ipcRenderer.invoke('pc:add'),
  renamePcGame: (id, title) => ipcRenderer.invoke('pc:rename', id, title),
  removePcGame: (id) => ipcRenderer.invoke('pc:remove', id),
  launch: (romPath) => ipcRenderer.invoke('game:launch', romPath),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  installEmulators: (ids) => ipcRenderer.invoke('emulators:install', ids),
  pickEmulatorExe: (id) => ipcRenderer.invoke('emulators:pickExe', id),
  clearEmulatorExe: (id) => ipcRenderer.invoke('emulators:clearExe', id),
  pickFolder: (current) => ipcRenderer.invoke('dialog:folder', current),
  openFolder: (which) => ipcRenderer.invoke('shell:open', which),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  skipUpdate: (version) => ipcRenderer.invoke('update:skip', version),
  onUpdateState: on('update:state'),
  onUpdatePrompt: on('update:prompt'),
  hide: () => ipcRenderer.invoke('app:hide'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onButton: on('pad:button'),
  onPadConnection: on('pad:connection'),
  onActive: on('app:active'),
  onGameExit: on('game:exit'),
  onInstallProgress: on('emulators:progress'),
});
