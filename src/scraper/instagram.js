'use strict';

const puppeteer = require('puppeteer');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractContactFromBio(bio) {
  if (!bio) return { telefone: null, email: null };
  const emailMatch = bio.match(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : null;
  const phoneMatch = bio.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}/);
  const telefone = phoneMatch ? phoneMatch[0].replace(/\D/g, '') : null;
  return { telefone, email };
}

function formatFollowers(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(',', '.'));
  if (isNaN(n)) return null;
  const lower = str.toLowerCase();
  if (lower.includes('k')) return Math.round(n * 1000);
  if (lower.includes('m')) return Math.round(n * 1000000);
  return Math.round(n);
}

async function scrapeInstagram(palavraChave, limit = 20) {
  console.log(`[instagram] Buscando "${palavraChave}" no Bing...`);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    protocolTimeout: 180000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,900',
      '--disable-blink-features=AutomationControlled',
      '--lang=pt-BR,pt',
      '--disable-extensions',
      '--disable-background-networking',
    ],
  });

  const results = [];
  const skipList = ['p', 'reel', 'explore', 'accounts', 'stories', 'tv', 'ar', 'about', 'legal', 'help', 'press', 'api', 'blog', 'directory'];

  try {
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

    async function searchBing(startPage) {
      const query = encodeURIComponent(`site:instagram.com "${palavraChave}"`);
      const url = `https://www.bing.com/search?q=${query}&count=30&setlang=pt-BR&first=${startPage}`;
      console.log(`[instagram] Buscando: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(2000);

      // Log page title to detect captcha/block
      const title = await page.title();
      console.log(`[instagram] Página: "${title}"`);

      return page.evaluate((skip) => {
        const links = new Set();
        // Bing wraps result links — check cite elements and data-url attributes too
        document.querySelectorAll('cite, [data-url], h2 a, .b_algo a').forEach((el) => {
          const text = el.getAttribute('data-url') || el.getAttribute('href') || el.textContent || '';
          const match = text.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)/);
          if (match && !skip.includes(match[1]) && match[1].length > 1) {
            links.add('https://www.instagram.com/' + match[1] + '/');
          }
        });
        // Also check all hrefs directly
        document.querySelectorAll('a[href]').forEach((a) => {
          const match = (a.href || '').match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?(?:\?.*)?$/);
          if (match && !skip.includes(match[1]) && match[1].length > 1) {
            links.add('https://www.instagram.com/' + match[1] + '/');
          }
        });
        return [...links];
      }, skipList);
    }

    let profileLinks = await searchBing(1);
    if (profileLinks.length < limit) {
      try {
        const more = await searchBing(31);
        more.forEach((l) => { if (!profileLinks.includes(l)) profileLinks.push(l); });
      } catch (_) {}
    }

    console.log(`[instagram] ${profileLinks.length} perfis encontrados`);
    if (profileLinks.length === 0) return results;

    const seen = new Set();
    for (const profileUrl of profileLinks.slice(0, limit)) {
      const username = profileUrl.replace(/https?:\/\/(?:www\.)?instagram\.com\//, '').replace(/\/$/, '');
      if (seen.has(username)) continue;
      seen.add(username);

      try {
        await sleep(1200 + Math.random() * 1300);
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(800);

        const data = await page.evaluate((url) => {
          const getMeta = (prop) => {
            const el = document.querySelector('meta[property="' + prop + '"], meta[name="' + prop + '"]');
            return el ? el.getAttribute('content') : null;
          };
          const ogTitle = getMeta('og:title') || document.title || '';
          const ogDesc = getMeta('og:description') || '';
          const uname = url.replace(/https?:\/\/(?:www\.)?instagram\.com\//, '').replace(/\/$/, '').split('?')[0];
          const nameMatch = ogTitle.match(/^(.+?)\s*\(@/);
          const nome = nameMatch ? nameMatch[1].trim() : ogTitle.split('•')[0].split('(')[0].trim();
          const followersMatch = ogDesc.match(/([\d,.]+[KkMm]?)\s*[Ff]ollowers/);
          const bioMatch = ogDesc.match(/Posts?\s*[-–]\s*(.+)$/s);
          const bio = bioMatch ? bioMatch[1].trim() : (ogDesc.length > 10 ? ogDesc : null);
          const isLoginWall = document.title.toLowerCase().includes('login') || window.location.href.includes('/accounts/login');
          return { nome, username: uname, bio, followersStr: followersMatch ? followersMatch[1] : null, url, isLoginWall };
        }, profileUrl);

        if (data.isLoginWall) { console.log('[instagram] Login wall — parando'); break; }
        if (!data.username || !data.nome || data.nome.length < 2) continue;

        const { telefone, email } = extractContactFromBio(data.bio);
        results.push({
          nome: data.nome,
          instagram_username: data.username,
          instagram_url: 'https://www.instagram.com/' + data.username + '/',
          bio: data.bio || null,
          followers_count: formatFollowers(data.followersStr),
          telefone: telefone || null,
          email: email || null,
        });
        console.log('[instagram] ✅ ' + data.nome + ' (@' + data.username + ')');
      } catch (err) {
        console.error('[instagram] Erro em ' + profileUrl + ':', err.message);
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = { scrapeInstagram };
