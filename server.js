// ============================================================
//  Twitch Drops Bot – Çoklu Müşteri (SaaS) Yönetim Sunucusu (server.js)
// ============================================================

import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { TwitchDropsBot, initSharedBrowser } from './bot.js';
import { db } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── CORS (Twitch'ten gelen istekleri kabul etmek için) ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://www.twitch.tv');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── BOT MANAGER ───────────────────────────────────────────────
const bots = new Map(); // login -> TwitchDropsBot instance

function makeLogger(login) {
  return (level, message) => {
    const time = new Date().toLocaleTimeString('tr-TR');
    console.log(`[${time}] [${login}] [${level.toUpperCase()}] ${message}`);
    broadcast({ type: 'log', login, level, message, time });
  };
}

async function startBotForUser(user) {
  if (bots.has(user.login)) return bots.get(user.login); // Zaten çalışıyor

  const logger = makeLogger(user.login);
  const bot = new TwitchDropsBot({ login: user.login, authToken: user.token, log: logger });
  bots.set(user.login, bot);
  
  await db.updateStatus(user.login, true);
  
  // Arka planda başlat
  bot.start().catch(err => {
    logger('error', `Bot başlatılırken hata: ${err.message}`);
    bot.stop();
    bots.delete(user.login);
    db.updateStatus(user.login, false);
  });
  
  return bot;
}

async function stopBotForUser(login) {
  const bot = bots.get(login);
  if (bot) {
    bot.running = false;
    await bot.stop().catch(() => {});
    bots.delete(login);
  }
  await db.updateStatus(login, false);
}

// ── API ENDPOINTLERİ ─────────────────────────────────────────

// Tüm kullanıcıları ve durumlarını getir
app.get('/api/users', (req, res) => {
  const users = db.getUsers().map(u => {
    const bot = bots.get(u.login);
    return {
      ...u,
      stats: bot ? bot.getStats() : null
    };
  });
  res.json(users);
});

// Yeni Kullanıcı Ekle (Token ile)
app.post('/api/users', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token gereklidir.' });

  try {
    // Token'ı Twitch üzerinden doğrula ve profil bilgilerini al
    const hRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { 'Authorization': `OAuth ${token}` }
    }).catch(() => null);

    if (!hRes || !hRes.ok) throw new Error('Geçersiz veya süresi dolmuş auth-token.');
    const vData = await hRes.json();
    const client_id = vData.client_id;
    const user_id = vData.user_id;

    let profile = { login: vData.login, display_name: vData.login };

    // Kullanıcı detaylarını çek
    const uRes = await fetch(`https://api.twitch.tv/helix/users?id=${user_id}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': client_id }
    }).catch(() => null);

    if (uRes && uRes.ok) {
      const uData = await uRes.json();
      if (uData.data && uData.data[0]) {
        profile = uData.data[0];
      }
    }

    const newUser = await db.addUser({
      id: user_id,
      login: profile.login,
      display_name: profile.display_name,
      profile_image_url: profile.profile_image_url || '',
      token: token
    });

    res.json({ ok: true, user: newUser, message: 'Kullanıcı eklendi.' });
    broadcast({ type: 'refresh_users' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Kullanıcı Sil
app.delete('/api/users/:login', async (req, res) => {
  const { login } = req.params;
  await stopBotForUser(login);
  await db.removeUser(login);
  res.json({ ok: true, message: 'Kullanıcı silindi.' });
  broadcast({ type: 'refresh_users' });
});

// Bot Başlat
app.post('/api/start/:login', async (req, res) => {
  const { login } = req.params;
  const user = db.getUser(login);
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  if (bots.has(login)) return res.status(400).json({ error: 'Bot zaten çalışıyor.' });

  await startBotForUser(user);
  res.json({ ok: true, message: 'Bot başlatıldı.' });
  broadcast({ type: 'refresh_users' });
});

// Bot Durdur
app.post('/api/stop/:login', async (req, res) => {
  const { login } = req.params;
  if (!bots.has(login)) return res.status(400).json({ error: 'Bot zaten çalışmıyor.' });

  await stopBotForUser(login);
  res.json({ ok: true, message: 'Bot durduruldu.' });
  broadcast({ type: 'refresh_users' });
});

// Sunucuyu (PM2) Yeniden Başlat
app.post('/api/restart-server', (req, res) => {
  res.json({ ok: true, message: 'Sunucu yeniden başlatılıyor...' });
  setTimeout(() => process.exit(1), 1000);
});

// ── BAŞLATMA ve WEBSOCKET ────────────────────────────────────

const server = app.listen(PORT, async () => {
  console.log(`[SİSTEM] Web yönetim paneli http://localhost:${PORT} üzerinde çalışıyor.`);
  
  // Veritabanını yükle
  await db.load();
  console.log(`[SİSTEM] Veritabanı yüklendi. Kayıtlı kullanıcı: ${db.getUsers().length}`);

  // Paylaşımlı tarayıcıyı başlat
  await initSharedBrowser();

  // Otomatik başlatma (Önceden çalışanları geri aç)
  const users = db.getUsers();
  for (const u of users) {
    if (u.isRunning) {
      console.log(`[SİSTEM] ${u.login} botu otomatik başlatılıyor...`);
      await startBotForUser(u);
    }
  }
});

const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const c of clients) {
    if (c.readyState === 1) c.send(payload);
  }
}

// İstatistikleri düzenli olarak panele gönder
setInterval(() => {
  const statsUpdate = db.getUsers().map(u => {
    const bot = bots.get(u.login);
    return { login: u.login, isRunning: u.isRunning, stats: bot ? bot.getStats() : null };
  });
  broadcast({ type: 'all_stats', data: statsUpdate });
}, 5000);
