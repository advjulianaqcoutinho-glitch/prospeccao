'use strict';

const puppeteer = require('puppeteer');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractContactFromBio(bio) {
  if (!bio) return { telefone: null, email: null };

  const emailMatch = bio.match(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : null;

  // Match Brazilian phone numbers in various formats
  const phoneMatch = bio.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}/);
  const telefone = phoneMatch ? phoneMatch[0].replace(/\D/g, '') : null;

  return { telefone, email };
}

async function scrapeInstagram(palavraChave, cidade, limit = 20) {
  console.log(`[instagram] Buscando "${palavraChave}" em "${cidade}"...`);

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

  try {
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

    // Step 1: Google search for Instagram profiles
    const query = encodeURIComponent(`site:instagram.com "${palavraChave}" "${cidade}"`);
    const googleUrl = `https://www.google.com/search?q=${query}&num=30&hl=pt-BR`;

    console.log(`[instagram] Google query: ${googleUrl}`);
    await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2000);

    // Accept cookies if prompted
    try {
      const acceptBtn = await page.$('button[id="L2AGLb"], button[aria-label*="Aceitar"]');
      if (acceptBtn) { await acceptBtn.click(); await sleep(1000); }
    } catch (_) {}

    // Extract Instagram profile URLs from Google results
    const profileLinks = await page.evaluate(() => {
      const links = new Set();
      document.querySelectorAll('a[href]').forEach((a) => {
        const href = a.href || '';
        const match = href.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?(?:\?.*)?$/);
        if (match) {
          const username = match[1];
          // Skip Instagram's own pages
          const skip = ['p', 'reel', 'explore', 'accounts', 'stories', 'tv', 'ar', 'about', 'legal', 'help', 'press', 'api', 'blog'];
          if (!skip.includes(username) && username.length > 1) {
            links.add(`https://www.instagram.com/${username}/`);
          }
        }
      });
      return [...links];
    });

    console.log(`[instagram] Found ${profileLinks.length} profile links from Google`);

    if (profileLinks.length === 0) {
      console.log('[instagram] No profiles found — Google may have shown captcha');
      return results;
    }

    // Step 2: Visit each profile to extract data
    const toVisit = profileLinks.slice(0, limit);

    for (const profileUrl of toVisit) {
      try {
        await sleep(1500 + Math.random() * 1500);

        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(1000);

        const data = await page.evaluate((url) => {
          // Try meta tags first (always available on public profiles)
          const getMeta = (prop) => {
            const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
            return el ? el.getAttribute('content') : null;
          };

          const ogTitle = getMeta('og:title') || '';
          const ogDesc = getMeta('og:description') || '';
          const username = url.replace(/https?:\/\/(?:www\.)?instagram\.com\//, '').replace(/\/$/, '').split('?')[0];

          // og:title format: "Nome do Perfil (@username) • Instagram"
          const nameMatch = ogTitle.match(/^(.+?)\s*\(@/);
          const nome = nameMatch ? nameMatch[1].trim() : ogTitle.split('•')[0].trim();

          // og:description format: "X Followers, Y Following, Z Posts - Bio text here"
          const followersMatch = ogDesc.match(/([\d,.]+[KkMm]?)\s*[Ff]ollowers/);
          const followersStr = followersMatch ? followersMatch[1] : null;
          let followers = null;
          if (followersStr) {
            const n = parseFloat(followersStr.replace(',', '.'));
            if (followersStr.toLowerCase().includes('k')) followers = Math.round(n * 1000);
            else if (followersStr.toLowerCase().includes('m')) followers = Math.round(n * 1000000);
            else followers = Math.round(n);
          }

          // Bio is everything after the "Posts - " part in og:description
          const bioMatch = ogDesc.match(/Posts?\s*[-–]\s*(.+)$/s);
          const bio = bioMatch ? bioMatch[1].trim() : ogDesc;

          // Check if it's a login wall (Instagram redirected)
          const isLoginWall = document.title.toLowerCase().includes('login') ||
            window.location.href.includes('/accounts/login');

          return { nome, username, bio, followers, url, isLoginWall };
        }, profileUrl);

        if (data.isLoginWall) {
          console.log(`[instagram] Login wall hit at ${profileUrl}, stopping`);
          break;
        }

        if (!data.username || !data.nome) {
          console.log(`[instagram] Skipping ${profileUrl} — no data extracted`);
          continue;
        }

        const { telefone, email } = extractContactFromBio(data.bio);

        results.push({
          nome: data.nome,
          instagram_username: data.username,
          instagram_url: data.url,
          bio: data.bio || null,
          followers_count: data.followers || null,
          telefone: telefone || null,
          email: email || null,
        });

        console.log(`[instagram] ✅ ${data.nome} (@${data.username}) — ${data.followers || '?'} seguidores`);
      } catch (err) {
        console.error(`[instagram] Error visiting ${profileUrl}:`, err.message);
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = { scrapeInstagram };
