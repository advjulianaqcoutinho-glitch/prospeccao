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
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1280,800',
      '--disable-blink-features=AutomationControlled',
      '--lang=pt-BR,pt'
    ]
  });

  const page = await browser.newPage();

  // Anti-detecção
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  await page.setViewport({ width: 1280, height: 800 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  const query = encodeURIComponent(`${nicho} ${cidade}`);
  const url = `https://www.google.com/maps/search/${query}/?hl=pt-BR`;

  console.log(`Acessando: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

  // Aguarda resultados aparecerem
  await page.waitForTimeout(3000);

  // Aceita cookies se aparecer
  try {
    const acceptBtn = await page.$('button[aria-label*="Aceitar"], button[aria-label*="Accept"], form[action*="consent"] button');
    if (acceptBtn) { await acceptBtn.click(); await page.waitForTimeout(2000); }
  } catch (e) {}

  let empresas = [];
  let tentativas = 0;
  const MAX_TENTATIVAS = 8;

  while (empresas.length < limit && tentativas < MAX_TENTATIVAS) {
    tentativas++;

    const results = await page.evaluate(() => {
      const found = [];

      // Seletores atualizados para o Google Maps 2024/2025
      const selectors = [
        'a[href*="/maps/place/"]',
        '[data-result-index]',
        '.Nv2PK',
        '[jsaction*="mouseover:pane"]'
      ];

      let items = [];
      for (const sel of selectors) {
        items = Array.from(document.querySelectorAll(sel));
        if (items.length > 0) break;
      }

      for (const item of items) {
        // Nome
        const nome =
          item.querySelector('.fontHeadlineSmall')?.innerText ||
          item.querySelector('.qBF1Pd')?.innerText ||
          item.querySelector('h3')?.innerText ||
          item.querySelector('[aria-label]')?.getAttribute('aria-label') ||
          '';

        // Telefone — tenta link tel: ou texto com padrão de telefone
        let telefone = item.querySelector('a[href^="tel:"]')?.href?.replace('tel:', '') || '';
        if (!telefone) {
          const texts = Array.from(item.querySelectorAll('*')).map(el => el.innerText || '');
          const match = texts.join(' ').match(/(\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4})/);
          if (match) telefone = match[1];
        }

        // Endereço
        const endereco =
          item.querySelector('.W4Efsd:last-child .W4Efsd span:last-child')?.innerText ||
          item.querySelector('.fontBodyMedium')?.innerText?.split('\n')?.[0] ||
          '';

        if (nome) found.push({ nome: nome.trim(), telefone: telefone.trim(), endereco: endereco.trim() });
      }

      return found;
    });

    console.log(`Tentativa ${tentativas}: ${results.length} itens encontrados na página`);

    for (const empresa of results) {
      if (
        empresa.nome &&
        empresa.telefone &&
        empresas.length < limit &&
        !empresas.find(e => e.telefone === empresa.telefone)
      ) {
        empresas.push(empresa);
        console.log(`Lead adicionado: ${empresa.nome} — ${empresa.telefone}`);
      }
    }

    if (empresas.length >= limit) break;

    // Scroll para carregar mais
    const scrollou = await page.evaluate(() => {
      const feed = document.querySelector('[role="feed"], div[aria-label*="Resultados"]');
      if (feed) { feed.scrollTop += 800; return true; }
      window.scrollBy(0, 800);
      return false;
    });

    await page.waitForTimeout(2500);

    // Verifica fim da lista
    const fimDaLista = await page.evaluate(() => {
      return !!document.querySelector('.Hk4XGb, .lCgAp');
    });

    if (fimDaLista) { console.log('Fim da lista atingido.'); break; }

    // Se nenhum resultado apareceu nas primeiras tentativas, tira screenshot para debug
    if (tentativas === 2 && results.length === 0) {
      try { await page.screenshot({ path: '/tmp/maps-debug.png' }); } catch (e) {}
      console.log('Nenhum resultado ainda. Verificando página...');
    }
  }

  await browser.close();
  console.log(`Scraping concluído. ${empresas.length} empresas encontradas.`);
  return empresas;
}

module.exports = { scrapeGoogleMaps };
