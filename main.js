const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');
const natUpnp = require('nat-upnp');

let mainWindow;
let localSignalingServer = null;
let upnpClient = null;
let upnpMappedPort = null;

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ interface: name, address: net.address });
      }
    }
  }
  return addresses;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 780,
    minWidth: 780,
    minHeight: 560,
    backgroundColor: '#0a0d14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true,
    title: 'CyberTalkie - Low-Latency P2P Voice & Screen'
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// IPC Handlers
ipcMain.handle('get-local-ips', () => {
  return getLocalIpAddresses();
});

// UPnP Automatic Port Mapping (Open router port automatically with zero config)
ipcMain.handle('try-upnp-map', async (event, port = 8765) => {
  return new Promise((resolve) => {
    try {
      if (!upnpClient) {
        upnpClient = natUpnp.createClient();
      }

      // Map both TCP (for local WebSocket signaling) and UDP (for WebRTC media)
      upnpClient.portMapping({
        public: port,
        private: port,
        ttl: 7200,
        description: 'CyberTalkie P2P Port'
      }, (err) => {
        if (err) {
          console.log('UPnP port map notice:', err.message);
          // Try to get external IP anyway
          upnpClient.externalIp((ipErr, ip) => {
            resolve({ success: false, externalIp: ip || null, error: err.message });
          });
        } else {
          upnpMappedPort = port;
          upnpClient.externalIp((ipErr, ip) => {
            resolve({ success: true, externalIp: ip || null, port });
          });
        }
      });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
});

ipcMain.handle('start-host-server', (event, port = 8765) => {
  if (localSignalingServer) {
    try {
      localSignalingServer.close();
    } catch (e) {}
  }

  return new Promise((resolve, reject) => {
    try {
      const server = http.createServer();
      const wss = new WebSocketServer({ server });

      const clients = new Set();

      wss.on('connection', (ws) => {
        clients.add(ws);
        
        ws.on('message', (message) => {
          for (const client of clients) {
            if (client !== ws && client.readyState === ws.OPEN) {
              client.send(message.toString());
            }
          }
        });

        ws.on('close', () => {
          clients.delete(ws);
          for (const client of clients) {
            if (client.readyState === ws.OPEN) {
              client.send(JSON.stringify({ type: 'peer-disconnected' }));
            }
          }
        });

        ws.on('error', () => {
          clients.delete(ws);
        });
      });

      server.listen(port, '0.0.0.0', () => {
        localSignalingServer = server;
        resolve({ success: true, port });
      });

      server.on('error', (err) => {
        reject(err.message);
      });
    } catch (err) {
      reject(err.message);
    }
  });
});

ipcMain.handle('stop-host-server', () => {
  if (localSignalingServer) {
    localSignalingServer.close();
    localSignalingServer = null;
  }
  if (upnpClient && upnpMappedPort) {
    try {
      upnpClient.portUnmapping({ public: upnpMappedPort });
    } catch (e) {}
  }
  return true;
});

ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 300, height: 180 }
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL()
  }));
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (localSignalingServer) {
      localSignalingServer.close();
    }
    if (upnpClient && upnpMappedPort) {
      try {
        upnpClient.portUnmapping({ public: upnpMappedPort });
      } catch (e) {}
    }
    app.quit();
  }
});
