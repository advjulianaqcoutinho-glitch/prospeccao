'use strict';

const puppeteer = require('puppeteer');

async function scrapeGoogleMaps(nicho, cidade, limit = 10) {
  console.log(`Iniciando scraping para "${nicho}" em "${cidade}"...`);

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

  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setViewport({ width: 1280, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  const query = encodeURIComponent(`${nicho} ${cidade}`);
  await page.goto(`https://www.google.com/maps/search/${query}/?hl=pt-BR`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForTimeout(4000);

  // Accept cookies if prompted
  try {
    await page.waitForSelector('button[aria-label*="Aceitar"], form[action*="consent"] button', {
      timeout: 3000,
    });
    await page.click('button[aria-label*="Aceitar"], form[action*="consent"] button');
    await page.waitForTimeout(1500);
  } catch (e) {
    // No consent dialog — continue
  }

  await page.waitForTimeout(3000);

  // ── Collect all links first using a single tab ────────────────────────────
  const collectedLinks = new Set();
  let semNovas = 0;

  while (collectedLinks.size < limit * 2) {
    const links = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
      return [...new Set(els.map((el) => el.href).filter((h) => h.includes('/maps/place/')))];
    });

    const antes = collectedLinks.size;
    links.forEach((l) => collectedLinks.add(l));

    if (collectedLinks.size >= limit * 2 || collectedLinks.size === antes) {
      semNovas++;
      if (semNovas >= 3) break;
    } else {
      semNovas = 0;
    }

    if (collectedLinks.size < limit * 2) {
      await page.evaluate(() => {
        const feed = document.querySelector('[role="feed"]');
        if (feed) feed.scrollTop += 1000;
        else window.scrollBy(0, 1000);
      });
      await page.waitForTimeout(2500);
    }
  }

  console.log(`Links coletados: ${collectedLinks.size}`);

  // ── Visit each detail page on the same tab ────────────────────────────────
  const empresas = [];
  const linksArr = Array.from(collectedLinks).slice(0, limit * 2);

  for (const link of linksArr) {
    if (empresas.length >= limit) break;

    try {
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2500);

      const dados = await page.evaluate(() => {
        const nome =
          document.querySelector('h1')?.innerText ||
          document.querySelector('[data-attrid="title"]')?.innerText ||
          '';

        let telefone = '';
        const telLink = document.querySelector('a[href^="tel:"]');
        if (telLink) {
          telefone = telLink.href.replace('tel:', '');
        } else {
          const btns = Array.from(
            document.querySelectorAll(
              'button[data-item-id*="phone"], [data-tooltip*="telefone"], [aria-label*="telefone"], [aria-label*="Telefone"]'
            )
          );
          for (const btn of btns) {
            const txt = btn.getAttribute('aria-label') || btn.getAttribute('data-item-id') || '';
            const match = txt.match(/(\+?[\d\s\-().]{8,})/);
            if (match) { telefone = match[1].trim(); break; }
          }
        }

        const enderecoEl =
          document.querySelector('button[data-item-id*="address"]') ||
          document.querySelector('[data-item-id="address"]') ||
          document.querySelector('[aria-label*="Endereço"]');
        const endereco =
          enderecoEl?.getAttribute('aria-label')?.replace('Endereço:', '').trim() ||
          enderecoEl?.innerText?.trim() ||
          '';

        let rating = null;
        for (const el of document.querySelectorAll('[aria-label*="estrela"], [aria-label*="star"]')) {
          const m = (el.getAttribute('aria-label') || '').match(/([\d][,.][\d]|[\d])\s*(estrela|star)/i);
          if (m) { rating = parseFloat(m[1].replace(',', '.')); break; }
        }

        let review_count = null;
        for (const el of document.querySelectorAll('[aria-label*="avalia"], [aria-label*="review"]')) {
          const label = el.getAttribute('aria-label') || el.innerText || '';
          const m = label.match(/([\d.,]+)\s*(avalia|review)/i);
          if (m) {
            const n = parseInt(m[1].replace(/\./g, '').replace(',', ''), 10);
            if (!isNaN(n)) { review_count = n; break; }
          }
        }
        if (review_count === null) {
          const m = document.body.innerText.match(/\(([\d.]+)\)/);
          if (m) { const n = parseInt(m[1].replace(/\./g, ''), 10); if (!isNaN(n) && n > 0) review_count = n; }
        }

        let website = null;
        for (const sel of ['a[data-item-id*="authority"]','a[aria-label*="Website"]','a[aria-label*="website"]','a[aria-label*="Site"]']) {
          const el = document.querySelector(sel);
          if (el) { website = el.getAttribute('href') || null; if (website) break; }
        }
        if (!website) {
          for (const a of document.querySelectorAll('a[href^="http"]')) {
            const label = (a.getAttribute('aria-label') || a.innerText || '').toLowerCase();
            if ((label.includes('site') || label.includes('website')) && !a.href.includes('google.com')) {
              website = a.href; break;
            }
          }
        }

        return { nome: nome.trim(), telefone: telefone.trim(), endereco, rating, review_count, website };
      });

      const google_maps_url = page.url();

      if (dados.nome && dados.telefone) {
        empresas.push({
          _link: link,
          nome: dados.nome,
          telefone: dados.telefone,
          endereco: dados.endereco,
          rating: dados.rating,
          review_count: dados.review_count,
          website: dados.website,
          google_maps_url,
        });
        console.log(`[${empresas.length}/${limit}] ${dados.nome} — ${dados.telefone}`);
      } else if (dados.nome) {
        console.log(`Sem telefone: ${dados.nome}`);
      }
    } catch (err) {
      console.log(`Erro ao acessar detalhe: ${err.message}`);
    }
  }

  await browser.close();

  const resultado = empresas.map(({ _link, ...rest }) => rest);
  console.log(`Scraping concluído. ${resultado.length} empresas com telefone encontradas.`);
  return resultado;
}

module.exports = { scrapeGoogleMaps };
