# CyberTalkie ⚡

Aplicativo ultrarrápido de comunicação por voz e compartilhamento de tela ponto-a-ponto (P2P via WebRTC) feito especialmente para jogos, focado em **mínima latência** e **zero dependência de servidores externos**.

Tudo roda localmente no seu computador ou através da sua rede local / VPN P2P (como Radmin VPN, Tailscale ou ZeroTier).

---

## 🚀 Principais Funcionalidades

1. **Áudio de Ultra-Baixa Latência**:
   - WebRTC Opus configurado com buffer mínimo (5ms) e sample rate de 48kHz.
   - Cancelamento de eco e supressão de ruído nativos sem delay perceptível.
   - VU Meters em tempo real mostrando a captação do microfone e áudio recebido.
   - Ajuste individual de volume (até 200%).
   - Botões de Mute rápido e Ensurdecer.

2. **Compartilhamento de Tela para Jogos**:
   - Transmissão direta a 60 FPS com resolução até 1080p.
   - Miniatura flutuante para você conferir o que está transmitindo.
   - Modo de Tela Cheia.

3. **100% P2P Local (Sem Servidor Central)**:
   - Uma pessoa clica em **Criar Sala (Host)**. O próprio app sobe um servidor WebSocket local ultra leve na porta configurada (padrão 8765) apenas para o handshake inicial do WebRTC.
   - A outra pessoa clica em **Conectar (Amigo)**, digita o IP e porta.
   - Uma vez conectados, o áudio e a tela fluem diretamente entre os dois computadores via UDP/WebRTC.

---

## 🎮 Como Usar com seu Amigo

### Cenário 1: Na mesma rede Wi-Fi / Cabo (LAN)
1. Você clica em **Criar Sala (Host)** -> **Iniciar Sala Local**.
2. O aplicativo mostrará seu IP local (ex: `192.168.1.50`). Basta clicar para copiar.
3. Seu amigo abre o CyberTalkie, vai na aba **Conectar (Amigo)**, digita o seu IP e clica em **Conectar**.
4. Pronto! O áudio conecta instantaneamente com latência inferior a 5ms.

### Cenário 2: Pela Internet (Sem abrir portas no roteador)
Para jogar com um amigo que mora longe sem precisar configurar redirecionamento de portas (port forwarding) no modem:
1. Usem um criador de rede virtual P2P como **Radmin VPN** ou **Tailscale** (ambos gratuitos).
2. O Host clica em **Criar Sala (Host)**.
3. Copie o IP gerado da VPN (ex: o IP do Radmin VPN).
4. O amigo cola o IP no campo de conexão e clica em **Conectar**.

---

## 🛠️ Como Rodar em Modo de Desenvolvimento

Requisitos: Node.js instalado.

```bash
# Instalar dependências
npm install

# Iniciar o aplicativo
npm start
```

## 📦 Como Gerar o Executável (.exe)

Para criar o instalador e a versão portátil executável:

```bash
npm run dist
```
Os arquivos `.exe` serão gerados dentro da pasta `dist/`. Basta enviar o arquivo `.exe` para seu amigo!
