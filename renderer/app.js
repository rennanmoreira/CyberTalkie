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
const btnMethodDirect = document.getElementById('btnMethodDirect');
const btnMethodCode = document.getElementById('btnMethodCode');
const directMethodSection = document.getElementById('directMethodSection');
const codeMethodSection = document.getElementById('codeMethodSection');

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
const upnpNotice = document.getElementById('upnpNotice');

const btnGenerateOffer = document.getElementById('btnGenerateOffer');
const p2pCodeBox = document.getElementById('p2pCodeBox');
const btnCopyCode = document.getElementById('btnCopyCode');
const btnApplyCode = document.getElementById('btnApplyCode');

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

// STUN servers for NAT punch-through without intermediate media relay
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 4
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
    
    const audioConstraints = {
      deviceId: deviceId,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      latency: 0.005,
      sampleRate: 48000
    };

    localAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false
    });

    setupLocalMeter(localAudioStream);

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
function createPeerConnection(onIceComplete = null) {
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
    if (event.candidate) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
      }
    } else {
      // ICE gathering complete
      if (onIceComplete) {
        onIceComplete();
      }
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

// WebSocket Signaling (Method 1)
function connectSignaling(address) {
  ws = new WebSocket(address);

  ws.onopen = () => {
    updateStatus('connecting');
    createPeerConnection();

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

// Method Switching
btnMethodDirect.addEventListener('click', () => {
  btnMethodDirect.classList.add('active');
  btnMethodCode.classList.remove('active');
  directMethodSection.classList.remove('hidden');
  codeMethodSection.classList.add('hidden');
});

btnMethodCode.addEventListener('click', () => {
  btnMethodCode.classList.add('active');
  btnMethodDirect.classList.remove('active');
  codeMethodSection.classList.remove('hidden');
  directMethodSection.classList.add('hidden');
});

// UPnP / Host Handler
btnStartHost.addEventListener('click', async () => {
  const port = parseInt(hostPort.value) || 8765;
  try {
    await window.electronAPI.startHostServer(port);
    const ips = await window.electronAPI.getLocalIps();
    
    // Attempt UPnP automatic router port forwarding
    upnpNotice.innerText = 'Configurando UPnP no roteador...';
    const upnpRes = await window.electronAPI.tryUpnpMap(port);

    localIpList.innerHTML = '';

    if (upnpRes.success) {
      upnpNotice.innerText = '✅ Porta aberta automaticamente no roteador via UPnP!';
      if (upnpRes.externalIp) {
        const extBadge = document.createElement('span');
        extBadge.className = 'ip-badge';
        extBadge.innerText = `🌐 IP Público (Internet): ${upnpRes.externalIp}:${port}`;
        extBadge.title = 'Clique para copiar IP público';
        extBadge.addEventListener('click', () => {
          navigator.clipboard.writeText(upnpRes.externalIp);
          alert(`IP Público ${upnpRes.externalIp} copiado! Seu amigo pode conectar diretamente por ele.`);
        });
        localIpList.appendChild(extBadge);
      }
    } else {
      upnpNotice.innerText = 'ℹ️ Use o IP local se estiver na mesma rede, ou use a aba "Código P2P" para conectar pela Internet.';
    }

    ips.forEach(item => {
      const badge = document.createElement('span');
      badge.className = 'ip-badge';
      badge.innerText = `🏠 IP Local: ${item.address}:${port} (${item.interface})`;
      badge.title = 'Clique para copiar';
      badge.addEventListener('click', () => {
        navigator.clipboard.writeText(item.address);
        alert(`IP ${item.address} copiado para a área de transferência!`);
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

// Join Handler
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

// Tab switching (Direct)
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

// --- Method 2: Code P2P Handshake (Zero Server, Zero VPN, Zero Router Port) ---
btnGenerateOffer.addEventListener('click', async () => {
  updateStatus('connecting');
  btnGenerateOffer.innerText = 'Gerando... aguarde candidatos STUN';

  createPeerConnection(() => {
    // When ICE gathering is done, package into base64 code
    const offerData = {
      type: 'offer',
      sdp: peerConnection.localDescription
    };
    const code = btoa(JSON.stringify(offerData));
    p2pCodeBox.value = code;
    btnGenerateOffer.innerText = 'Código Pronto! Copie e envie.';
  });

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
});

btnCopyCode.addEventListener('click', () => {
  const code = p2pCodeBox.value.trim();
  if (code) {
    navigator.clipboard.writeText(code);
    alert('Código copiado para a área de transferência!');
  }
});

btnApplyCode.addEventListener('click', async () => {
  const rawCode = p2pCodeBox.value.trim();
  if (!rawCode) {
    alert('Cole o código do seu amigo na caixa de texto primeiro!');
    return;
  }

  try {
    const data = JSON.parse(atob(rawCode));

    if (data.type === 'offer') {
      // Amigo recebeu a oferta: gera a resposta (answer)
      updateStatus('connecting');
      createPeerConnection(async () => {
        const answerData = {
          type: 'answer',
          sdp: peerConnection.localDescription
        };
        p2pCodeBox.value = btoa(JSON.stringify(answerData));
        alert('Código de resposta gerado! Clique em Copiar Código e envie de volta para seu amigo.');
      });

      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

    } else if (data.type === 'answer') {
      // Host original recebe a resposta
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
      alert('Conexão P2P finalizada! Estabelecendo áudio e vídeo...');
    }
  } catch (err) {
    alert('Código inválido ou corrompido: ' + err.message);
  }
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

    const videoTrack = localScreenStream.getVideoTracks()[0];
    if (peerConnection) {
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(videoTrack);
      } else {
        peerConnection.addTrack(videoTrack, localScreenStream);
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
