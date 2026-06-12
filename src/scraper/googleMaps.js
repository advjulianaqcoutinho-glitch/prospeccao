'use strict';

const puppeteer = require('puppeteer');

async function scrapeGoogleMaps(nicho, cidade, limit = 10) {
  console.log(`Iniciando scraping para "${nicho}" em "${cidade}"...`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,900',
      '--disable-blink-features=AutomationControlled',
      '--lang=pt-BR,pt',
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
    waitUntil: 'networkidle2',
    timeout: 45000,
  });

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

  const empresas = [];
  let semNovas = 0;

  while (empresas.length < limit) {
    // Grab all visible place links
    const links = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
      return [...new Set(els.map((el) => el.href).filter((h) => h.includes('/maps/place/')))];
    });

    for (const link of links) {
      if (empresas.length >= limit) break;
      if (empresas.find((e) => e._link === link)) continue;

      try {
        const detailPage = await browser.newPage();
        await detailPage.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        await detailPage.goto(link, { waitUntil: 'networkidle2', timeout: 20000 });
        await detailPage.waitForTimeout(2000);

        const dados = await detailPage.evaluate(() => {
          // ── Nome ──────────────────────────────────────────────────────────
          const nome =
            document.querySelector('h1')?.innerText ||
            document.querySelector('[data-attrid="title"]')?.innerText ||
            '';

          // ── Telefone ──────────────────────────────────────────────────────
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
              const txt =
                btn.getAttribute('aria-label') || btn.getAttribute('data-item-id') || '';
              const match = txt.match(/(\+?[\d\s\-().]{8,})/);
              if (match) {
                telefone = match[1].trim();
                break;
              }
            }
          }

          // ── Endereço ──────────────────────────────────────────────────────
          const enderecoEl =
            document.querySelector('button[data-item-id*="address"]') ||
            document.querySelector('[data-item-id="address"]') ||
            document.querySelector('[aria-label*="Endereço"]');
          const endereco =
            enderecoEl?.getAttribute('aria-label')?.replace('Endereço:', '').trim() ||
            enderecoEl?.innerText?.trim() ||
            '';

          // ── Rating ────────────────────────────────────────────────────────
          // aria-label like "4,5 estrelas" or "4.5 stars"
          let rating = null;
          const ratingCandidates = Array.from(
            document.querySelectorAll('[aria-label*="estrela"], [aria-label*="star"]')
          );
          for (const el of ratingCandidates) {
            const label = el.getAttribute('aria-label') || '';
            const match = label.match(/([\d][,.][\d]|[\d])\s*(estrela|star)/i);
            if (match) {
              rating = parseFloat(match[1].replace(',', '.'));
              break;
            }
          }

          // ── Review count ─────────────────────────────────────────────────
          // e.g. "(1.234)" or "1.234 avaliações" or "1,234 reviews"
          let review_count = null;
          const reviewCandidates = Array.from(
            document.querySelectorAll('[aria-label*="avalia"], [aria-label*="review"]')
          );
          for (const el of reviewCandidates) {
            const label = el.getAttribute('aria-label') || el.innerText || '';
            // Match digits with optional thousands separator
            const match = label.match(/([\d.,]+)\s*(avalia|review)/i);
            if (match) {
              const cleaned = match[1].replace(/\./g, '').replace(',', '');
              const n = parseInt(cleaned, 10);
              if (!isNaN(n)) {
                review_count = n;
                break;
              }
            }
          }
          // Fallback: look for text like "(1.234)"
          if (review_count === null) {
            const bodyText = document.body.innerText;
            const m = bodyText.match(/\(([\d.]+)\)/);
            if (m) {
              const n = parseInt(m[1].replace(/\./g, ''), 10);
              if (!isNaN(n) && n > 0) review_count = n;
            }
          }

          // ── Website ───────────────────────────────────────────────────────
          let website = null;
          // Look for a "Website" button/link
          const websiteBtnSelectors = [
            'a[data-item-id*="authority"]',
            'a[aria-label*="Website"]',
            'a[aria-label*="website"]',
            'a[aria-label*="Site"]',
            'button[data-item-id*="authority"]',
          ];
          for (const sel of websiteBtnSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              website = el.getAttribute('href') || el.getAttribute('data-href') || null;
              if (website) break;
            }
          }
          // Fallback: find an external link labeled "Site" or "Website"
          if (!website) {
            const allLinks = Array.from(document.querySelectorAll('a[href^="http"]'));
            for (const a of allLinks) {
              const label = (a.getAttribute('aria-label') || a.innerText || '').toLowerCase();
              if (label.includes('site') || label.includes('website')) {
                const href = a.href;
                if (href && !href.includes('google.com')) {
                  website = href;
                  break;
                }
              }
            }
          }

          return {
            nome: nome.trim(),
            telefone: telefone.trim(),
            endereco,
            rating,
            review_count,
            website,
          };
        });

        // Capture the canonical detail page URL
        const google_maps_url = detailPage.url();

        await detailPage.close();

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

    if (empresas.length >= limit) break;

    // Scroll to load more results
    const antes = links.length;
    await page.evaluate(() => {
      const feed = document.querySelector('[role="feed"]');
      if (feed) feed.scrollTop += 1000;
      else window.scrollBy(0, 1000);
    });
    await page.waitForTimeout(3000);

    const depois = await page.evaluate(
      () => document.querySelectorAll('a[href*="/maps/place/"]').length
    );

    if (depois <= antes) {
      semNovas++;
      if (semNovas >= 3) {
        console.log('Sem mais resultados.');
        break;
      }
    } else {
      semNovas = 0;
    }
  }

  await browser.close();

  // Strip internal _link field
  const resultado = empresas.map(({ _link, ...rest }) => rest);
  console.log(`Scraping concluído. ${resultado.length} empresas com telefone encontradas.`);
  return resultado;
}

module.exports = { scrapeGoogleMaps };
