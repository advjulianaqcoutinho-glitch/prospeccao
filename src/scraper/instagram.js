'use strict';

const puppeteer = require('puppeteer');

function extractContactFromBio(bio) {
  if (!bio) return { telefone: null, email: null };

  const emailMatch = bio.match(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : null;

  // Match Brazilian phone numbers in various formats
  const phoneMatch = bio.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}/);
  const telefone = phoneMatch ? phoneMatch[0].replace(/\D/g, '') : null;

  return { telefone, email };
}

async function scrapeInstagram(palavraChave, limit = 20) {
  console.log(`[instagram] Buscando "${palavraChave}" via Bing...`);

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

    const searchUrl = `https://www.bing.com/search?q=site%3Ainstagram.com+%22${encodeURIComponent(palavraChave)}%22&count=30&setlang=pt-BR`;

    console.log(`[instagram] Bing query: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Extract Instagram profile URLs from Bing results
    const profileUrls = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="instagram.com/"]'));
      const urls = [];
      for (const link of links) {
        const href = link.href;
        const match = href.match(/https?:\/\/(www\.)?instagram\.com\/([^/?#]+)/);
        if (match) {
          const username = match[2];
          if (!['p', 'reel', 'tv', 'stories', 'explore', 'accounts', 'directory'].includes(username)) {
            urls.push(`https://www.instagram.com/${username}/`);
          }
        }
      }
      return [...new Set(urls)];
    });

    console.log(`[instagram] Found ${profileUrls.length} profile links from Bing`);

    if (profileUrls.length === 0) {
      console.log('[instagram] No profiles found — Bing may have blocked or returned no results');
      return results;
    }

    for (const url of profileUrls.slice(0, limit)) {
      try {
        const profilePage = await browser.newPage();
        await profilePage.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        await profilePage.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

        const data = await profilePage.evaluate((profileUrl) => {
          const getMeta = (prop) => {
            const el = document.querySelector(`meta[property="${prop}"]`) || document.querySelector(`meta[name="${prop}"]`);
            return el ? el.getAttribute('content') : null;
          };
          const ogTitle = getMeta('og:title') || document.title || '';
          const ogDesc = getMeta('og:description') || '';
          const ogUrl = getMeta('og:url') || window.location.href;

          // Extract username from URL
          const urlMatch = ogUrl.match(/instagram\.com\/([^/?#]+)/);
          const username = urlMatch ? urlMatch[1] : '';

          // og:title format: "Nome do Perfil (@username) • Instagram"
          const nameMatch = ogTitle.match(/^(.+?)\s*\(@/);
          const nome = nameMatch ? nameMatch[1].trim() : ogTitle.split('•')[0].trim() || username;

          // Extract followers from description (e.g. "1,234 Followers")
          const followersMatch = ogDesc.match(/([\d,\.]+[KkMm]?)\s*[Ff]ollowers/);
          const followersStr = followersMatch ? followersMatch[1] : null;
          let followers = null;
          if (followersStr) {
            const n = parseFloat(followersStr.replace(/,/g, ''));
            if (followersStr.toLowerCase().includes('k')) followers = Math.round(n * 1000);
            else if (followersStr.toLowerCase().includes('m')) followers = Math.round(n * 1000000);
            else followers = Math.round(n);
          }

          // Bio is everything after "Posts - " in og:description
          const bioMatch = ogDesc.match(/Posts?\s*[-–]\s*(.+)$/s);
          const bio = bioMatch ? bioMatch[1].trim() : ogDesc;

          const isLoginWall = document.title.toLowerCase().includes('login') ||
            window.location.href.includes('/accounts/login');

          return {
            nome,
            username,
            bio,
            followers_count: followers || 0,
            instagram_url: ogUrl || profileUrl,
            isLoginWall,
          };
        }, url);

        if (data.isLoginWall) {
          console.log(`[instagram] Login wall hit at ${url}, stopping`);
          await profilePage.close();
          break;
        }

        if (!data.username || !data.nome) {
          console.log(`[instagram] Skipping ${url} — no data extracted`);
          await profilePage.close();
          continue;
        }

        const { telefone, email } = extractContactFromBio(data.bio);

        results.push({
          nome: data.nome,
          instagram_username: data.username,
          instagram_url: data.instagram_url,
          bio: data.bio || null,
          followers_count: data.followers_count || null,
          telefone: telefone || null,
          email: email || null,
        });

        console.log(`[instagram] ✅ ${data.nome} (@${data.username}) — ${data.followers_count || '?'} seguidores`);
        await profilePage.close();
      } catch (err) {
        console.error(`[instagram] Error visiting profile: ${url}`, err.message);
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = { scrapeInstagram };
