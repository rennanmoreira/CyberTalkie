// WebRTC P2P low-latency engine for CyberTalkie

let ws = null;
let peerConnection = null;
let localAudioStream = null;
let localScreenStream = null;
let isHost = true;
let isMuted = false;
let isDeafened = false;

// Audio processing & meters
let audioContext = null;
let localAnalyser = null;
let remoteAnalyser = null;
let statsInterval = null;

// DOM Elements
const tabHost = document.getElementById('tabHost');
const tabJoin = document.getElementById('tabJoin');
const hostSection = document.getElementById('hostSection');
const joinSection = document.getElementById('joinSection');
const btnStartHost = document.getElementById('btnStartHost');
const btnJoinHost = document.getElementById('btnJoinHost');
const hostPort = document.getElementById('hostPort');
const joinIp = document.getElementById('joinIp');
const joinPort = document.getElementById('joinPort');
const hostInfo = document.getElementById('hostInfo');
const localIpList = document.getElementById('localIpList');

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

const micSelect = document.getElementById('micSelect');
const btnToggleMic = document.getElementById('btnToggleMic');
const btnToggleDeafen = document.getElementById('btnToggleDeafen');
const micLabel = document.getElementById('micLabel');
const deafenLabel = document.getElementById('deafenLabel');
const localMeterFill = document.getElementById('localMeterFill');
const remoteMeterFill = document.getElementById('remoteMeterFill');
const peerVolumeSlider = document.getElementById('peerVolumeSlider');
const peerVolumeVal = document.getElementById('peerVolumeVal');

const statPing = document.getElementById('statPing');
const statJitter = document.getElementById('statJitter');
const statCandidate = document.getElementById('statCandidate');

const btnShareScreen = document.getElementById('btnShareScreen');
const btnStopShare = document.getElementById('btnStopShare');
const btnFullscreen = document.getElementById('btnFullscreen');
const remoteVideo = document.getElementById('remoteVideo');
const localPreviewVideo = document.getElementById('localPreviewVideo');
const remoteAudio = document.getElementById('remoteAudio');
const screenPlaceholder = document.getElementById('screenPlaceholder');
const screenLiveBadge = document.getElementById('screenLiveBadge');

const screenPickerModal = document.getElementById('screenPickerModal');
const screenList = document.getElementById('screenList');
const btnCloseModal = document.getElementById('btnCloseModal');

// WebRTC Configuration optimized for direct host/p2p communication
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 2
};

// Initialize device lists
async function initDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    micSelect.innerHTML = '';
    devices.filter(d => d.kind === 'audioinput').forEach(d => {
      const option = document.createElement('option');
      option.value = d.deviceId;
      option.text = d.label || `Microfone (${micSelect.length + 1})`;
      micSelect.appendChild(option);
    });
  } catch (err) {
    console.error('Erro ao listar dispositivos:', err);
  }
}

// Setup local microphone stream with low-latency settings
async function startLocalAudio() {
  try {
    const deviceId = micSelect.value ? { exact: micSelect.value } : undefined;
    
    // Constraints tuned for ultra-low latency Opus
    const audioConstraints = {
      deviceId: deviceId,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      latency: 0.005, // 5ms requested buffer
      sampleRate: 48000
    };

    localAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false
    });

    setupLocalMeter(localAudioStream);

    // If peerConnection exists, replace or add track
    if (peerConnection) {
      const audioTrack = localAudioStream.getAudioTracks()[0];
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender) {
        sender.replaceTrack(audioTrack);
      } else {
        peerConnection.addTrack(audioTrack, localAudioStream);
      }
    }
  } catch (err) {
    console.error('Erro ao capturar microfone:', err);
  }
}

// Audio metering
function setupLocalMeter(stream) {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  const source = audioContext.createMediaStreamSource(stream);
  localAnalyser = audioContext.createAnalyser();
  localAnalyser.fftSize = 64;
  source.connect(localAnalyser);

  const dataArray = new Uint8Array(localAnalyser.frequencyBinCount);
  function updateMeter() {
    if (localAnalyser) {
      localAnalyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;
      const percentage = Math.min(100, (avg / 128) * 100);
      localMeterFill.style.width = isMuted ? '0%' : `${percentage}%`;
    }
    requestAnimationFrame(updateMeter);
  }
  updateMeter();
}

function setupRemoteMeter(stream) {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  const source = audioContext.createMediaStreamSource(stream);
  remoteAnalyser = audioContext.createAnalyser();
  remoteAnalyser.fftSize = 64;
  source.connect(remoteAnalyser);

  const dataArray = new Uint8Array(remoteAnalyser.frequencyBinCount);
  function updateMeter() {
    if (remoteAnalyser) {
      remoteAnalyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;
      const percentage = Math.min(100, (avg / 128) * 100);
      remoteMeterFill.style.width = isDeafened ? '0%' : `${percentage}%`;
    }
    requestAnimationFrame(updateMeter);
  }
  updateMeter();
}

// Initialize WebRTC Peer Connection
function createPeerConnection() {
  if (peerConnection) {
    peerConnection.close();
  }

  peerConnection = new RTCPeerConnection(rtcConfig);

  // Add microphone audio tracks
  if (localAudioStream) {
    localAudioStream.getAudioTracks().forEach(track => {
      peerConnection.addTrack(track, localAudioStream);
    });
  }

  // Add screen track if currently sharing
  if (localScreenStream) {
    localScreenStream.getVideoTracks().forEach(track => {
      peerConnection.addTrack(track, localScreenStream);
    });
  }

  // Handle incoming tracks
  peerConnection.ontrack = (event) => {
    const track = event.track;
    const stream = event.streams[0] || new MediaStream([track]);

    if (track.kind === 'audio') {
      remoteAudio.srcObject = stream;
      setupRemoteMeter(stream);
    } else if (track.kind === 'video') {
      remoteVideo.srcObject = stream;
      screenPlaceholder.classList.add('hidden');
      screenLiveBadge.classList.remove('hidden');

      track.onended = () => {
        remoteVideo.srcObject = null;
        screenPlaceholder.classList.remove('hidden');
        screenLiveBadge.classList.add('hidden');
      };
    }
  };

  // ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
    }
  };

  peerConnection.onconnectionstatechange = () => {
    updateStatus(peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      startStatsMonitor();
    } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
      stopStatsMonitor();
    }
  };

  // Optimize audio codec parameters in SDP for lowest latency
  return peerConnection;
}

function updateStatus(state) {
  statusDot.className = 'status-indicator';
  if (state === 'connected') {
    statusDot.classList.add('connected');
    statusText.innerText = 'Conectado P2P';
  } else if (state === 'connecting') {
    statusDot.classList.add('connecting');
    statusText.innerText = 'Conectando...';
  } else {
    statusText.innerText = 'Desconectado';
  }
}

// Monitor WebRTC Latency & Stats
function startStatsMonitor() {
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(async () => {
    if (!peerConnection) return;
    try {
      const stats = await peerConnection.getStats();
      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (report.currentRoundTripTime !== undefined) {
            statPing.innerText = `${Math.round(report.currentRoundTripTime * 1000)} ms`;
          }
        }
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          if (report.jitter !== undefined) {
            statJitter.innerText = `${Math.round(report.jitter * 1000)} ms`;
          }
        }
      });
    } catch (e) {}
  }, 1000);
}

function stopStatsMonitor() {
  if (statsInterval) clearInterval(statsInterval);
  statPing.innerText = '-- ms';
  statJitter.innerText = '-- ms';
}

// Connect to Signaling Server
function connectSignaling(address) {
  ws = new WebSocket(address);

  ws.onopen = () => {
    updateStatus('connecting');
    createPeerConnection();

    // If Host, create WebRTC offer
    if (isHost) {
      makeOffer();
    }
  };

  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);

      if (message.type === 'offer') {
        if (!peerConnection) createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'answer', answer }));
      } else if (message.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
      } else if (message.type === 'candidate') {
        if (peerConnection) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
      } else if (message.type === 'peer-disconnected') {
        updateStatus('disconnected');
        screenPlaceholder.classList.remove('hidden');
        screenLiveBadge.classList.add('hidden');
        remoteVideo.srcObject = null;
      }
    } catch (e) {
      console.error('Signaling error:', e);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    updateStatus('error');
  };

  ws.onclose = () => {
    updateStatus('disconnected');
  };
}

async function makeOffer() {
  if (!peerConnection) return;
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'offer', offer }));
}

// Host button handler
btnStartHost.addEventListener('click', async () => {
  const port = parseInt(hostPort.value) || 8765;
  try {
    await window.electronAPI.startHostServer(port);
    const ips = await window.electronAPI.getLocalIps();
    localIpList.innerHTML = '';

    ips.forEach(item => {
      const badge = document.createElement('span');
      badge.className = 'ip-badge';
      badge.innerText = `${item.address}:${port} (${item.interface})`;
      badge.title = 'Clique para copiar';
      badge.addEventListener('click', () => {
        navigator.clipboard.writeText(item.address);
        alert(`IP ${item.address} copiado para a área de transferência! Envie para seu amigo.`);
      });
      localIpList.appendChild(badge);
    });

    hostInfo.classList.remove('hidden');
    btnStartHost.innerText = 'Servidor Ativo!';
    btnStartHost.style.background = '#00e676';

    isHost = true;
    connectSignaling(`ws://127.0.0.1:${port}`);
  } catch (err) {
    alert('Erro ao iniciar servidor host: ' + err);
  }
});

// Join button handler
btnJoinHost.addEventListener('click', () => {
  const ip = joinIp.value.trim();
  const port = parseInt(joinPort.value) || 8765;
  if (!ip) {
    alert('Por favor digite o IP do host!');
    return;
  }
  isHost = false;
  connectSignaling(`ws://${ip}:${port}`);
});

// Tab switching
tabHost.addEventListener('click', () => {
  tabHost.classList.add('active');
  tabJoin.classList.remove('active');
  hostSection.classList.remove('hidden');
  joinSection.classList.add('hidden');
});

tabJoin.addEventListener('click', () => {
  tabJoin.classList.add('active');
  tabHost.classList.remove('active');
  joinSection.classList.remove('hidden');
  hostSection.classList.add('hidden');
});

// Audio Mute & Deafen
btnToggleMic.addEventListener('click', () => {
  isMuted = !isMuted;
  if (localAudioStream) {
    localAudioStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
  }
  if (isMuted) {
    btnToggleMic.classList.add('active-danger');
    micLabel.innerText = 'Desmutar Mic';
  } else {
    btnToggleMic.classList.remove('active-danger');
    micLabel.innerText = 'Mutar Mic';
  }
});

btnToggleDeafen.addEventListener('click', () => {
  isDeafened = !isDeafened;
  remoteAudio.muted = isDeafened;
  if (isDeafened) {
    btnToggleDeafen.classList.add('active-danger');
    deafenLabel.innerText = 'Ativar Som';
  } else {
    btnToggleDeafen.classList.remove('active-danger');
    deafenLabel.innerText = 'Ensurdecer';
  }
});

peerVolumeSlider.addEventListener('input', (e) => {
  const val = e.target.value;
  peerVolumeVal.innerText = `${val}%`;
  remoteAudio.volume = val / 100;
});

micSelect.addEventListener('change', () => {
  startLocalAudio();
});

// Screen Sharing Logic (Electron desktopCapturer)
btnShareScreen.addEventListener('click', async () => {
  const sources = await window.electronAPI.getScreenSources();
  screenList.innerHTML = '';
  
  sources.forEach(src => {
    const item = document.createElement('div');
    item.className = 'screen-item';
    item.innerHTML = `
      <img src="${src.thumbnail}">
      <span>${src.name}</span>
    `;
    item.addEventListener('click', () => {
      startScreenCapture(src.id);
      screenPickerModal.classList.add('hidden');
    });
    screenList.appendChild(item);
  });

  screenPickerModal.classList.remove('hidden');
});

btnCloseModal.addEventListener('click', () => {
  screenPickerModal.classList.add('hidden');
});

async function startScreenCapture(sourceId) {
  try {
    localScreenStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080,
          minFrameRate: 30,
          maxFrameRate: 60
        }
      }
    });

    localPreviewVideo.srcObject = localScreenStream;
    localPreviewVideo.classList.remove('hidden');

    btnShareScreen.classList.add('hidden');
    btnStopShare.classList.remove('hidden');

    // Add track to peer connection
    const videoTrack = localScreenStream.getVideoTracks()[0];
    if (peerConnection) {
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(videoTrack);
      } else {
        peerConnection.addTrack(videoTrack, localScreenStream);
        // Renegotiate
        if (ws && ws.readyState === WebSocket.OPEN) {
          makeOffer();
        }
      }
    }

    videoTrack.onended = () => {
      stopScreenCapture();
    };
  } catch (err) {
    console.error('Falha ao compartilhar tela:', err);
  }
}

function stopScreenCapture() {
  if (localScreenStream) {
    localScreenStream.getTracks().forEach(track => track.stop());
    localScreenStream = null;
  }
  localPreviewVideo.srcObject = null;
  localPreviewVideo.classList.add('hidden');
  btnShareScreen.classList.remove('hidden');
  btnStopShare.classList.add('hidden');

  if (peerConnection) {
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) {
      peerConnection.removeTrack(sender);
      if (ws && ws.readyState === WebSocket.OPEN) {
        makeOffer();
      }
    }
  }
}

btnStopShare.addEventListener('click', stopScreenCapture);

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.getElementById('previewWrapper').requestFullscreen().catch(err => alert(err));
  } else {
    document.exitFullscreen();
  }
});

// Initialize on start
window.addEventListener('DOMContentLoaded', async () => {
  await initDevices();
  await startLocalAudio();
});
