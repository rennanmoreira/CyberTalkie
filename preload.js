const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getLocalIps: () => ipcRenderer.invoke('get-local-ips'),
  startHostServer: (port) => ipcRenderer.invoke('start-host-server', port),
  stopHostServer: () => ipcRenderer.invoke('stop-host-server'),
  tryUpnpMap: (port) => ipcRenderer.invoke('try-upnp-map', port),
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources')
});
