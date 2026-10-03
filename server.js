// server.js — Webhook YouTube Live para o canal @AtitudeTV
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors()); // permite a página no Skip consultar este servidor

const HANDLE = 'AtitudeTV';            // handle do canal (@AtitudeTV)
const API_KEY = 'SUA_CHAVE_DE_API';    // ⚠️ NÃO TROQUE: mantenha a chave que já está no seu arquivo
const PORT = 3000;

let CHANNEL_ID = null;
let liveStatus = { isLive: false, videoId: null, title: null, updatedAt: null };
let lastVideoId = null;

// ── 1) Resolve o ID do canal (UC...) a partir do handle @AtitudeTV ──
async function resolveChannelId() {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${HANDLE}&key=${API_KEY}`;
  const { data } = await axios.get(url);
  CHANNEL_ID = data.items?.[0]?.id || null;
  if (!CHANNEL_ID) throw new Error('Canal @AtitudeTV não encontrado. Verifique a chave de API.');
  console.log('✅ Canal resolvido:', CHANNEL_ID);
}

// ── 2) Inscrição automática no WebSub (notificação por push) ──
async function subscribeWebSub() {
  const params = new URLSearchParams();
  params.append('hub.callback', `https://live-atitude.onrender.com/webhook/youtube`); // URL do servidor no Render
  params.append('hub.topic', `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
  params.append('hub.mode', 'subscribe');
  params.append('hub.verify', 'async');
  await axios.post('https://pubsubhubbub.appspot.com/subscribe', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  console.log('✅ Inscrição WebSub enviada para o canal', CHANNEL_ID);
}

// ── 3) Verificação da inscrição — o YouTube envia um GET com hub.challenge ──
app.get('/webhook/youtube', (req, res) => {
  const challenge = req.query['hub.challenge'];
  if (challenge) return res.status(200).send(challenge);
  res.sendStatus(200);
});

// ── 4) Notificação de push — POST em XML quando o canal publica/entra no ar ──
app.post('/webhook/youtube', express.text({ type: '*/*' }), async (req, res) => {
  res.sendStatus(200); // responde rápido, processa depois
  try {
    const videoId = req.body.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1];
    if (!videoId) return;
    lastVideoId = videoId;
    await checkLive(videoId);
  } catch (err) {
    console.error('Erro ao processar notificação:', err.message);
  }
});

// ── 5) Consulta a API para confirmar se o vídeo está AO VIVO agora ──
async function checkLive(videoId) {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${videoId}&key=${API_KEY}`;
  const { data } = await axios.get(url);
  const item = data.items?.[0];
  if (!item) return;

  const isLive = item.snippet.liveBroadcastContent === 'live';
  liveStatus = {
    isLive,
    videoId: isLive ? videoId : null,
    title: item.snippet.title,
    updatedAt: new Date().toISOString(),
  };
  console.log('📡 Status atualizado:', liveStatus);
}

// ── 6) Busca inicial: verifica se já existe live em andamento agora ──
async function checkCurrentLive() {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${CHANNEL_ID}&eventType=live&type=video&key=${API_KEY}`;
  const { data } = await axios.get(url);
  const item = data.items?.[0];
  if (item) {
    lastVideoId = item.id.videoId;
    await checkLive(lastVideoId);
  }
}

// ── 7) Reconsulta o último vídeo a cada 60s (cobre lives agendadas que começam depois) ──
setInterval(async () => {
  if (lastVideoId) {
    try { await checkLive(lastVideoId); } catch (err) { /* ignora falhas temporárias */ }
  }
}, 60000);

// ── 8) Endpoint que a página no Skip consulta ──
app.get('/api/live-status', (req, res) => {
  res.json(liveStatus);
});

// ── 9) Página de boas-vindas — aparece quando alguém abre o endereço direto ──
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Atitude TV — Servidor</title>
      </head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 80px 20px; background: #1a1a2e; color: #ffffff;">
        <h1>🙏 Servidor da Atitude TV</h1>
        <p>Este servidor está no ar e aguardando a próxima transmissão ao vivo.</p>
        <p>Para assistir ao culto, acesse a página oficial da igreja.</p>
        <p style="color: #d4af37;">Igreja Batista Atitude — Barra da Tijuca, Rio de Janeiro</p>
      </body>
    </html>
  `);
});

// ── Inicialização ──
app.listen(PORT, async () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  try {
    await resolveChannelId();
    await checkCurrentLive();
    await subscribeWebSub();
  } catch (err) {
    console.error('Erro na inicialização:', err.message);
  }
});
