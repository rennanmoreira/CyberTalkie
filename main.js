const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');
const os = require('os');

let mainWindow;
let localSignalingServer = null;

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // IPv4 only and non-internal
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ interface: name, address: net.address });
      }
    }
  }
  return addresses;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 700,
    minHeight: 500,
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
          // Broadcast to other peers
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
    app.quit();
  }
});
