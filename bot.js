// ============================================================
//  Twitch Drops Bot – Çoklu Müşteri (SaaS) Motoru (bot.js)
//  Puppeteer Context Pooling, Albion Online odaklı drop toplayıcı
// ============================================================

import puppeteer from 'puppeteer';

const DROPS_TAG               = 'c2542d6d-cd10-4532-919b-3d19f30a768b';
const GAME_SLUG               = 'albion-online';
const CLAIM_CHECK_INTERVAL_MS =  5 * 60 * 1000; // 5 dakika (Envanter & Drop kontrolü)
const STREAM_CHECK_INTERVAL_MS =  5 * 60 * 1000; // 5 dakika (Yayıncı sağlık kontrolü)
const NO_STREAM_WAIT_MS        = 15 * 60 * 1000; // 15 dakika (Yayın bulunamadığında bekleme)
const SLEEP_DURATION_MS        =  1 * 60 * 60 * 1000; // 1 saat (Uyku modu)
const RECONNECT_DELAY_MS       =  2 * 60 * 1000; // 2 dakika (Hata durumunda bekleme)

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
      statusText:     'Başlatılıyor...',
      statusMessage:  'Başlatılıyor...',
    };
    this._claimTimer  = null;
    this._streamTimer = null;
    this._idleCount   = 0;
    this.sleepingUntil= 0;
  }

  _updateStatus(msg) {
    this.stats.statusMessage = msg;
    this.log('info', msg);
  }

  async start() {
    if (this.running) { this.log('warn', 'Bot zaten çalışıyor.'); return; }
    this.running = true;
    this.stats.startedAt = new Date().toISOString();
    this._updateStatus('🚀 Bot başlatılıyor, Twitch.tv\'ye bağlanılıyor...');
    await this._mainLoop();
  }

  async stop() {
    this.running = false;
    clearInterval(this._claimTimer);
    clearInterval(this._streamTimer);
    await this._cleanup();
    this.log('info', '🛑 Bot durduruldu.');
  }

  getStats() {
    let uptimeMs = 0;
    if (this.running && this.stats.startedAt) {
        uptimeMs = Date.now() - new Date(this.stats.startedAt).getTime();
    }
    return { ...this.stats, running: this.running, uptimeMs }; 
  }

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
          this.log('warn', '⚠️ Aktif Albion Online Drop Kampanyası bulunamadı. 1 saat uyku moduna geçiliyor...');
          this.sleepingUntil = Date.now() + SLEEP_DURATION_MS;
          await this._cleanup();
          continue;
        }

        const channel = await this._findDropChannel();
        if (!channel) {
          this.log('warn', '⚠️  Aktif Drops etkin yayın bulunamadı. 15 dk sonra tekrar deneniyor…');
          await this._sleep(NO_STREAM_WAIT_MS);
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

  // ── SETUP ───────────────────────────────────────────────

  async _setup() {
    this.stats.statusText = "Twitch sunucularına bağlanılıyor...";
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
    this.stats.statusText = "Hesap oturumu doğrulandı.";
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
    this.stats.statusText = "Albion Online kategorisindeki kampanyalar taranıyor...";
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
    this.stats.statusText = "Drop veren uygun yayıncılar aranıyor...";
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
    this.stats.statusText = `Hedef yayıncı (${channel}) bulundu, bağlanılıyor...`;
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
    
    // Inventory sayfasinda görsel ve resim isteklerine izin ver
    await page.setRequestInterception(false);
    
    try {
      await page.goto('https://www.twitch.tv/drops/inventory', {
        waitUntil: 'networkidle2', timeout: 30_000,
      });
      await this._sleep(6_000); // Twitch dinamik render icin bekle

      const parseResult = await page.evaluate(() => {
        const inProgress = [];
        const claimedList = [];
        let totalClaimedCount = 0;

        // ── 1. İLERLEYEN / DEVAM EDEN DROPLAR ──
        const progressBars = document.querySelectorAll(
          '[data-a-target="tw-progress-bar-animation"], [role="progressbar"], ' +
          '[data-test-selector*="progress"], .progress-bar__fill'
        );
        
        progressBars.forEach(bar => {
          let progress = parseInt(bar.getAttribute('value')) || 
                         parseInt(bar.getAttribute('aria-valuenow')) || 
                         parseInt(bar.style.width) || 0;
          let container = bar;
          let name = 'Bilinmeyen Drop';
          let image = null;
          let isReadyToClaim = false;
          
          // Kapsayıcı kart div'ini bul
          for (let i = 0; i < 12; i++) {
            container = container.parentElement;
            if (!container) break;

            const claimBtn = container.querySelector(
              'button[data-test-selector="DropsCampaignInProgressRewardPresentation-claim-button"], ' +
              'button[data-a-target="tw-core-button"]'
            );
            if (claimBtn) {
              const btnText = claimBtn.textContent.toLowerCase();
              if (btnText.includes('talep') || btnText.includes('claim') || btnText.includes('al')) {
                isReadyToClaim = true;
                progress = 100;
              }
            }

            const nameEl = container.querySelector(
              'h4, h3, h2, p.tw-strong, .tw-title, ' +
              '[data-test-selector*="reward-name"], [data-test-selector*="drop-name"], ' +
              '.ScTitleText-sc, p[title]'
            );
            if (nameEl && nameEl.textContent.trim().length > 1) {
              name = nameEl.textContent.trim();
              
              const imgs = container.querySelectorAll('img');
              let chestImg = null, campaignImg = null, fallbackImg = null;
              
              for (const img of imgs) {
                if (!img.src || !img.src.startsWith('http')) continue;
                const s = img.src.toLowerCase();
                if (s.includes('chest') || s.includes('reward') || s.includes('item') || s.includes('drop-reward')) {
                  chestImg = img.src; break;
                }
                if (s.includes('campaign') || s.includes('drop')) {
                  if (!campaignImg) campaignImg = img.src;
                }
                if (!fallbackImg) fallbackImg = img.src;
              }
              
              image = chestImg || campaignImg || fallbackImg;
              break;
            }
          }
          
          if (name === 'Bilinmeyen Drop' && container) {
            const allP = container.querySelectorAll('p, span');
            for (const p of allP) {
              if (p.textContent.includes('%')) {
                const imgs = container.querySelectorAll('img');
                if (imgs[0]) { name = imgs[0].alt || 'Albion Drop'; image = imgs[0].src; }
                const match = p.textContent.match(/(\d+)\s*%|%(\d+)/);
                if (match && progress === 0) progress = parseInt(match[1] || match[2]);
                break;
              }
            }
          }

          if (progress >= 100) isReadyToClaim = true;
          
          const isExpired = container && (
            container.textContent.includes('Bu kampanya kapanmış') ||
            container.textContent.includes('ended') ||
            container.textContent.includes('Closed')
          );

          if (name && name !== 'Bilinmeyen Drop' && !inProgress.find(r => r.name === name)) {
            inProgress.push({
              name,
              progress: Math.min(progress, 100),
              image: (image && image.startsWith('http')) ? image : null,
              isReadyToClaim,
              isExpired,
              status: isReadyToClaim ? 'ready' : (isExpired ? 'expired' : 'in_progress')
            });
          }
        });

        // ── 2. ALINAN (CLAIMED) DROPLARIN AYRIŞTIRILMASI ──
        const fullBodyText = document.body.innerText || '';
        const allLines = fullBodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        let startIdx = 0;
        for (let idx = 0; idx < allLines.length; idx++) {
          const l = allLines[idx].toLowerCase();
          if (l === 'alınan' || l === 'claimed' || l.startsWith('alınan ') || l.startsWith('claimed ')) {
            startIdx = idx + 1;
            break;
          }
        }

        const timePattern = /(?:\d+\s*(?:sn|saniye|dk|dakika|saat|gün|hafta|ay|yıl|sec|second|min|minute|hr|hour|day|week|month|year)s?\s*(?:önce|ago)|\b(?:dün|yesterday|bugün|today|evvelsi\s*gün|just now|şimdi)\b)/i;

        const isIgnoreLine = (l) => {
          const s = l.toLowerCase();
          return s.includes('talep sayısına') || s.includes('altı ay içinde') || s.includes('ayrıntı') ||
                 s.includes('depending on') || s.includes('six months') || s.includes('learn more') ||
                 s.startsWith('http') || s.startsWith('[') || s === 'alınan' || s === 'claimed';
        };

        const isTimeLine = (l) => {
          const s = l.toLowerCase();
          if (s.includes('talep sayısına') || s.includes('altı ay')) return false;
          return timePattern.test(s);
        };

        const allRewardImages = Array.from(document.querySelectorAll('img')).filter(img => {
          const s = (img.src || '').toLowerCase();
          return s.startsWith('http') && (s.includes('chest') || s.includes('reward') || s.includes('drop') || s.includes('campaign') || s.includes('item'));
        });

        let i = startIdx;
        while (i < allLines.length) {
          const line = allLines[i];

          if (isIgnoreLine(line)) {
            i++;
            continue;
          }

          if (isTimeLine(line)) {
            const timeStr = line;
            let qty = 1;
            let name = '';
            i++;

            if (i < allLines.length && /^\d+$/.test(allLines[i])) {
              qty = parseInt(allLines[i], 10);
              i++;
            }

            if (i < allLines.length && !isTimeLine(allLines[i]) && !isIgnoreLine(allLines[i])) {
              name = allLines[i];
              i++;
            }

            if (name && name.length > 1 && !name.includes('http')) {
              let matchedImg = null;
              const cleanName = name.toLowerCase();
              for (const imgEl of allRewardImages) {
                const alt = (imgEl.alt || '').toLowerCase();
                const src = (imgEl.src || '').toLowerCase();
                if ((alt && cleanName.includes(alt)) || (alt && alt.includes(cleanName)) ||
                    src.includes(cleanName.replace(/\s+/g, '')) || (src.includes('chest') && cleanName.includes('chest'))) {
                  matchedImg = imgEl.src;
                  break;
                }
              }
              if (!matchedImg && allRewardImages.length > 0) {
                matchedImg = allRewardImages[claimedList.length % allRewardImages.length]?.src || null;
              }

              claimedList.push({
                name,
                quantity: qty,
                date: timeStr,
                image: matchedImg,
                progress: 100,
                status: 'claimed'
              });
              totalClaimedCount += qty;
            }
          } else {
            if (/^\d+$/.test(line) && i + 1 < allLines.length && !isTimeLine(allLines[i+1]) && !isIgnoreLine(allLines[i+1])) {
              const qty = parseInt(line, 10);
              const name = allLines[i+1];
              if (name && name.length > 1) {
                claimedList.push({
                  name,
                  quantity: qty,
                  date: 'Alındı',
                  image: null,
                  progress: 100,
                  status: 'claimed'
                });
                totalClaimedCount += qty;
                i += 2;
                continue;
              }
            }
            i++;
          }
        }

        // DOM Fallback
        if (claimedList.length === 0) {
          const fallbackImgs = document.querySelectorAll('img[src*="campaign"], img[src*="chest"], img[src*="drop"]');
          fallbackImgs.forEach(img => {
            let c = img.closest('div[data-test-selector]') || img.parentElement?.parentElement;
            if (c && (
              c.textContent.includes('önce') || c.textContent.includes('Claim') ||
              c.textContent.includes('Alındı') || c.textContent.includes('ago') ||
              c.textContent.includes('Redeemed')
            )) {
              let cName = img.alt || 'Alınan Sandık';
              const sib = img.parentElement?.nextElementSibling;
              if (sib && sib.textContent.trim()) cName = sib.textContent.trim();
              if (!claimedList.find(x => x.name === cName)) {
                claimedList.push({
                  name: cName.substring(0, 35),
                  quantity: 1,
                  date: 'Alındı',
                  image: img.src,
                  progress: 100,
                  status: 'claimed'
                });
                totalClaimedCount += 1;
              }
            }
          });
        }

        return {
          inProgress,
          claimedList,
          totalClaimedCount
        };
      }).catch((e) => {
        console.error('Evaluate error:', e);
        return { inProgress: [], claimedList: [], totalClaimedCount: 0 };
      });

      const { inProgress, claimedList, totalClaimedCount } = parseResult;

      this.stats.claimedCount = totalClaimedCount;
      this.stats.inventory = [...inProgress, ...claimedList];

      if (inProgress.length > 0) {
        this.stats.dropName = inProgress[0].name;
        this.stats.dropProgress = inProgress[0].progress;
      } else if (claimedList.length > 0) {
        this.stats.dropName = claimedList[0].name;
        this.stats.dropProgress = 100;
      } else {
        this.stats.dropName = null;
        this.stats.dropProgress = 0;
      }

      const readyDrop = inProgress.find(d => d.isReadyToClaim || d.progress >= 100);
      if (readyDrop) {
        this.log('success', `🎉 ${readyDrop.name} DROP'U %100 DOLDU! Twitch sayfasından talep edebilirsiniz.`);
      } else if (this.stats.dropProgress > 0) {
        this.log('info', `📊 Drop ilerlemesi: %${this.stats.dropProgress} (${this.stats.dropName || 'Albion Drop'}) | 🎁 Alınan Toplam Kutu: ${this.stats.claimedCount}`);
      } else {
        this.log('info', `ℹ️  İlerleyen drop aranıyor... | 🎁 Alınan Toplam Kutu: ${this.stats.claimedCount}`);
      }

      if (inProgress.length === 0 || this.stats.dropProgress === 0) {
        this._idleCount++;
      } else {
        this._idleCount = 0;
      }

      if (this._idleCount >= 4) {
        this.log('warn', '⚠️ Uzun süredir ilerleme yok (Tüm drop limitleri dolmuş olabilir). 1 saat uyku moduna geçiliyor...');
        this.sleepingUntil = Date.now() + SLEEP_DURATION_MS; 
        this._idleCount = 0;
        clearInterval(this._claimTimer);
        clearInterval(this._streamTimer);
        this.stats.currentChannel = null;
        if (this.streamPage) await this.streamPage.close().catch(()=>{});
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
