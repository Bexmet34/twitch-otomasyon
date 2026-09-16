// ============================================================
//  Twitch Drops Bot – Çoklu Müşteri (SaaS) Motoru (bot.js)
//  Puppeteer Context Pooling, Albion Online odaklı drop toplayıcı
// ============================================================

import puppeteer from 'puppeteer';

const DROPS_TAG              = 'c2542d6d-cd10-4532-919b-3d19f30a768b';
const GAME_SLUG              = 'albion-online';
const CLAIM_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 dakika
const STREAM_CHECK_INTERVAL_MS =  15 * 60 * 1000; // 15 dakika
const RECONNECT_DELAY_MS       =   2 * 60 * 1000; // 2 dakika

// Tüm botların paylaşacağı tek Chrome uygulaması
let sharedBrowser = null;

export async function initSharedBrowser() {
  if (sharedBrowser) return sharedBrowser;
  console.log('[SİSTEM] Paylaşımlı Chrome başlatılıyor...');
  sharedBrowser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.CHROME_PATH || (process.platform === 'win32' 
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' 
      : '/usr/bin/google-chrome'),
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas',
      '--disable-gpu', '--mute-audio', '--window-size=1280,720',
      '--disable-extensions'
    ],
    defaultViewport: { width: 1280, height: 720 },
  });
  return sharedBrowser;
}

export class TwitchDropsBot {
  constructor({ login, authToken, log }) {
    this.login      = login;
    this.authToken  = authToken;
    this.log        = log || console.log;
    this.running    = false;
    this.context    = null; // Incognito Context
    this.streamPage = null;
    this.stats      = {
      claimedCount:   0,
      startedAt:      null,
      currentChannel: null,
      dropProgress:   0,
      dropName:       null,
      nextCheckAt:    null,
      inventory:      [],
    };
    this._claimTimer  = null;
    this._streamTimer = null;
    this._idleCount   = 0;
    this.sleepingUntil= 0;
  }

  async start() {
    if (this.running) { this.log('warn', 'Bot zaten çalışıyor.'); return; }
    this.running = true;
    this.stats.startedAt = new Date().toISOString();
    this.log('info', '🚀 Bot başlatılıyor…');
    await this._mainLoop();
  }

  async stop() {
    this.running = false;
    clearInterval(this._claimTimer);
    clearInterval(this._streamTimer);
    await this._cleanup();
    this.log('info', '🛑 Bot durduruldu.');
  }

  getStats() { return { ...this.stats, running: this.running }; }

  // ── MAIN LOOP ───────────────────────────────────────────

  async _mainLoop() {
    while (this.running) {
      try {
        if (this.sleepingUntil > Date.now()) {
            const sleepMs = this.sleepingUntil - Date.now();
            this.log('info', `💤 Bot uyku modunda. ${(sleepMs/3600000).toFixed(1)} saat sonra uyanacak...`);
            await this._sleep(sleepMs);
            continue;
        }

        await this._setup();
        const isActive = await this._isCampaignActive();
        if (!isActive) {
          this.log('warn', '⚠️ Aktif Albion Online Drop Kampanyası bulunamadı. 4 saat uyku moduna geçiliyor...');
          this.sleepingUntil = Date.now() + (4 * 60 * 60 * 1000);
          await this._cleanup();
          continue;
        }

        const channel = await this._findDropChannel();
        if (!channel) {
          this.log('warn', '⚠️  Aktif Drops etkin yayın bulunamadı. 5 dk sonra tekrar deneniyor…');
          await this._sleep(STREAM_CHECK_INTERVAL_MS);
          await this._cleanup();
          continue;
        }
        await this._watchChannel(channel);
        this._startClaimLoop();
        this._startStreamHealthCheck();
        await this._waitUntilStopped();
      } catch (err) {
        this.log('error', `❌ Hata: ${err.message}`);
        await this._cleanup();
        if (this.running) {
          this.log('info', `🔄 ${RECONNECT_DELAY_MS / 1000}s sonra yeniden bağlanılıyor…`);
          await this._sleep(RECONNECT_DELAY_MS);
        }
      }
    }
  }

  // ── SETUP ───────────────────────────────────────────────

  async _setup() {
    this.log('info', '🌐 İzole Sekme (Context) oluşturuluyor…');
    if (!sharedBrowser) await initSharedBrowser();
    
    // Her kullanıcıya özel gizli sekme ortamı
    this.context = await sharedBrowser.createIncognitoBrowserContext();
    
    const tempPage = await this._newPage();
    await tempPage.goto('https://www.twitch.tv', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await tempPage.setCookie({
      name: 'auth-token', value: this.authToken,
      domain: '.twitch.tv', path: '/', secure: true, httpOnly: false,
    });
    await tempPage.close();
    this.log('info', '🔑 Auth-token yüklendi.');
  }

  // ── OPTİMİZE SAYFA OLUŞTURMA ─────────────────────────────
  
  async _newPage() {
      if (!this.context) throw new Error("Tarayıcı context'i bulunamadı!");
      const page = await this.context.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      );
      
      // RAM ve İnternet Tasarrufu: Görsel, medya ve fontları yükleme!
      await page.setRequestInterception(true);
      page.on('request', (req) => {
          const type = req.resourceType();
          if (['image', 'media', 'font'].includes(type)) {
              req.abort();
          } else {
              req.continue();
          }
      });
      return page;
  }

  // ── KAMPANYA KONTROLÜ ───────────────────────────────────

  async _isCampaignActive() {
    this.log('info', '🔎 Aktif Albion Online kampanyası var mı kontrol ediliyor...');
    const page = await this._newPage();
    try {
      await page.goto('https://www.twitch.tv/drops/campaigns', {
        waitUntil: 'networkidle2', 
        timeout: 30_000 
      });
      await this._sleep(5000);

      const hasAlbion = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('albion online') || text.includes('albion');
      });

      if (hasAlbion) this.log('info', '✅ Aktif Albion kampanyası bulundu!');
      return hasAlbion;
    } catch (err) {
      this.log('warn', `⚠️ Kampanya sayfası okunamadı: ${err.message}. Riske girmemek için var kabul ediliyor.`);
      return true; 
    } finally {
      await page.close();
    }
  }

  // ── KANAL BULMA ─────────────────────────────────────────

  async _findDropChannel() {
    this.log('info', '🔍 Albion Online – Drops Enabled kanallar aranıyor…');
    const page = await this._newPage();
    try {
      await page.goto(
        `https://www.twitch.tv/directory/category/${GAME_SLUG}?tl=${DROPS_TAG}`,
        { waitUntil: 'domcontentloaded', timeout: 30_000 }
      );
      await this._sleep(5_000); // Sayfanın render olması için bekle
      
      const href = await page.evaluate(() => {
        // En yaygın yayın kartı link seçicileri
        const card = document.querySelector('a[data-a-target="preview-card-image-link"]') 
                  || document.querySelector('article a[href]')
                  || document.querySelector('.tw-tower a[href]');
        return card ? card.getAttribute('href') : null;
      });

      if (!href) return null;
      const channel = href.replace('/', '').trim();
      this.log('info', `📺 Kanal bulundu: ${channel}`);
      return channel;
    } finally {
      await page.close();
    }
  }

  // ── YAYINI İZLE ─────────────────────────────────────────

  async _watchChannel(channel) {
    this.stats.currentChannel = channel;
    this.log('info', `▶️  ${channel} kanalına bağlanılıyor…`);
    this.streamPage = await this._newPage();
    await this.streamPage.goto(`https://www.twitch.tv/${channel}`, {
      waitUntil: 'domcontentloaded', timeout: 30_000,
    });
    await this._sleep(5_000);
    await this._dismissPopups(this.streamPage);
    await this._setLowestQuality(this.streamPage);
    this.log('info', `✅ ${channel} kanalı izleniyor (düşük kalite, arka plan).`);
  }

  async _dismissPopups(page) {
    const selectors = [
      'button[data-a-target="player-overlay-mature-accept"]',
      'button[data-a-target="content-classification-gate-overlay-start-watching-button"]',
      '[data-a-target="modal-close-button"]',
    ];
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 2000 });
        await page.click(sel);
        await this._sleep(500);
      } catch (_) {}
    }
  }

  async _setLowestQuality(page) {
    try {
      await page.waitForSelector('[data-a-target="player-settings-button"]', { timeout: 8_000 });
      await page.click('[data-a-target="player-settings-button"]');
      await this._sleep(800);
      await page.waitForSelector('[data-a-target="player-settings-menu-item-quality"]', { timeout: 4_000 });
      await page.click('[data-a-target="player-settings-menu-item-quality"]');
      await this._sleep(600);
      const options = await page.$$('[data-a-target="player-settings-menu"] input[type="radio"]');
      if (options.length > 0) {
        await options[options.length - 1].click();
        this.log('info', '📉 Video kalitesi en düşüğe alındı (bant tasarrufu).');
      }
      await this._sleep(500);
    } catch (_) {
      this.log('warn', '⚠️  Kalite ayarlanamadı, varsayılan devam edecek.');
    }
  }

  // ── CLAIM DÖNGÜSÜ ───────────────────────────────────────

  _startClaimLoop() {
    const runCheck = async () => {
      await this._checkAndClaim();
      this.stats.nextCheckAt = Date.now() + CLAIM_CHECK_INTERVAL_MS;
    };

    this.stats.nextCheckAt = Date.now() + 60_000;
    setTimeout(runCheck, 60_000);

    this._claimTimer = setInterval(runCheck, CLAIM_CHECK_INTERVAL_MS);
    this.log('info', `⏰ Claim kontrolü her ${CLAIM_CHECK_INTERVAL_MS / 1000} saniyede bir yapılacak.`);
  }

  async _checkAndClaim() {
    if (!this.running || !this.context) return;
    this.log('info', '🔎 Drop envanteri kontrol ediliyor…');

    const page = await this._newPage();
    try {
      await page.goto('https://www.twitch.tv/drops/inventory', {
        waitUntil: 'domcontentloaded', timeout: 20_000,
      });
      await this._sleep(3_000);

      const inventoryData = await page.evaluate(() => {
        const results = [];
        const progressBars = document.querySelectorAll('[data-a-target="tw-progress-bar-animation"], [role="progressbar"]');
        progressBars.forEach(bar => {
          let progress = parseInt(bar.getAttribute('value')) || 
                         parseInt(bar.getAttribute('aria-valuenow')) || 
                         parseInt(bar.style.width) || 0;
          let container = bar;
          let name = 'Bilinmeyen Drop';
          let image = null;
          for (let i = 0; i < 8; i++) {
              container = container.parentElement;
              if (!container) break;
              const nameEl = container.querySelector('h4, h3, p.tw-strong, .tw-title, [data-test-selector*="reward-name"]');
              if (nameEl && nameEl.textContent.trim().length > 0) {
                  name = nameEl.textContent.trim();
                  const imgEl = container.querySelector('img');
                  if (imgEl) image = imgEl.src;
                  break;
              }
          }
          if (name === 'Bilinmeyen Drop' && container) {
              const allP = container.querySelectorAll('p');
              for (const p of allP) {
                  if (p.textContent.includes('%')) {
                      const img = container.querySelector('img');
                      if (img && img.alt) name = img.alt;
                      const match = p.textContent.match(/%(\d+)/);
                      if(match && progress === 0) progress = parseInt(match[1]);
                      break;
                  }
              }
          }
          if(!results.find(r => r.name === name)) {
             results.push({ name, progress, image });
          }
        });

        const allImages = document.querySelectorAll('img[src*="campaign"], img[src*="chest"]');
        allImages.forEach(img => {
            if(results.find(r => r.image === img.src)) return;
            let container = img.closest('div[data-test-selector]') || img.parentElement.parentElement;
            if (container && (container.textContent.includes('önce') || container.textContent.includes('Claim') || container.textContent.includes('Alındı') || container.textContent.includes('ago') || container.textContent.includes('hakkında'))) {
                let name = 'Alınan Ödül';
                const siblingText = img.parentElement.nextElementSibling;
                if (siblingText && siblingText.textContent.trim()) {
                  name = siblingText.textContent.trim();
                } else if (img.alt) {
                  name = img.alt;
                }
                results.push({ name: name.substring(0,25) + ' (Alındı)', progress: 100, image: img.src });
            }
        });
        return results;
      }).catch(() => []);

      this.stats.inventory = inventoryData;
      if (inventoryData.length > 0) {
        this.stats.dropName = inventoryData[0].name;
        this.stats.dropProgress = inventoryData[0].progress;
      } else {
        this.stats.dropName = null;
        this.stats.dropProgress = 0;
      }

      const claimSel = 'button[data-test-selector="DropsCampaignInProgressRewardPresentation-claim-button"]';
      const claimBtn = await page.$(claimSel);

      if (claimBtn) {
        await claimBtn.click();
        this.stats.claimedCount++;
        this.stats.dropProgress = 100;
        this.log('success', `🎁 DROP TOPLANDII! Toplam: ${this.stats.claimedCount}`);
        await this._sleep(2_000);
        const extra = await page.$(claimSel);
        if (extra) {
          await extra.click();
          this.stats.claimedCount++;
          this.log('success', `🎁 Ekstra drop! Toplam: ${this.stats.claimedCount}`);
        }
        this.stats.dropProgress = 0; 
      } else {
        const p = this.stats.dropProgress;
        this.log('info', p > 0 ? `📊 Drop ilerlemesi: %${p}` : 'ℹ️  Henüz toplanacak drop yok.');
        
        if (inventoryData.length === 0 || p === 0) {
            this._idleCount++;
        } else {
            this._idleCount = 0;
        }

        if (this._idleCount >= 3) {
            this.log('warn', '⚠️ Uzun süredir ilerleme yok (Sınır dolmuş olabilir).');
            this.sleepingUntil = Date.now() + (4 * 60 * 60 * 1000); 
            this._idleCount = 0;
            clearInterval(this._claimTimer);
            clearInterval(this._streamTimer);
            this.stats.currentChannel = null;
            if (this.streamPage) await this.streamPage.close().catch(()=>{});
        }
      }
    } catch (err) {
      this.log('warn', `⚠️  Envanter kontrolü başarısız: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  // ── STREAM SAĞLIK KONTROLÜ ──────────────────────────────

  _startStreamHealthCheck() {
    this._streamTimer = setInterval(() => this._checkStream(), STREAM_CHECK_INTERVAL_MS);
  }

  async _checkStream() {
    if (!this.running || !this.streamPage) return;
    try {
      if (this.streamPage.isClosed()) {
        this.log('warn', '⚠️  Yayın sayfası kapandı, yeniden bağlanılacak…');
        this.stats.currentChannel = null;
        clearInterval(this._claimTimer);
        clearInterval(this._streamTimer);
        return;
      }
      
      const isOffline = await this.streamPage.evaluate(() => {
          return !!document.querySelector('div[data-a-target="home-offline-indicator"]') ||
                 !!document.querySelector('.channel-info-content [data-a-target="home-offline-indicator"]');
      }).catch(() => false);

      if (isOffline) {
          this.log('warn', '⚠️  İzlenen kanal çevrimdışı oldu. Yeni kanal aranacak…');
          this.stats.currentChannel = null;
          clearInterval(this._claimTimer);
          clearInterval(this._streamTimer);
          await this.streamPage.close().catch(()=>{});
      }
    } catch (err) {
      this.log('warn', `⚠️  Stream kontrolü hatası: ${err.message}`);
    }
  }

  // ── YARDIMCILAR ─────────────────────────────────────────

  async _cleanup() {
    clearInterval(this._claimTimer);
    clearInterval(this._streamTimer);
    this.stats.currentChannel = null;
    this.stats.nextCheckAt    = null;
    try { if (this.context) await this.context.close(); } catch (_) {}
    this.context    = null;
    this.streamPage = null;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async _waitUntilStopped() {
    while (this.running && this.streamPage && !this.streamPage.isClosed()) {
      await this._sleep(10_000);
    }
  }
}
