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
      '--lang=pt-BR,pt'
    ]
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
    timeout: 45000
  });

  // Aceita cookies se aparecer
  try {
    await page.waitForSelector('button[aria-label*="Aceitar"], form[action*="consent"] button', { timeout: 3000 });
    await page.click('button[aria-label*="Aceitar"], form[action*="consent"] button');
    await page.waitForTimeout(1500);
  } catch (e) {}

  await page.waitForTimeout(3000);

  const empresas = [];
  let semNovas = 0;

  while (empresas.length < limit) {
    // Pega links das empresas visíveis na lista
    const links = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
      return [...new Set(els.map(el => el.href).filter(h => h.includes('/maps/place/')))];
    });

    for (const link of links) {
      if (empresas.length >= limit) break;
      if (empresas.find(e => e._link === link)) continue;

      try {
        // Abre página de detalhes em nova aba
        const detailPage = await browser.newPage();
        await detailPage.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        await detailPage.goto(link, { waitUntil: 'networkidle2', timeout: 20000 });
        await detailPage.waitForTimeout(2000);

        const dados = await detailPage.evaluate(() => {
          // Nome
          const nome =
            document.querySelector('h1')?.innerText ||
            document.querySelector('[data-attrid="title"]')?.innerText || '';

          // Telefone
          let telefone = '';
          const telLink = document.querySelector('a[href^="tel:"]');
          if (telLink) {
            telefone = telLink.href.replace('tel:', '');
          } else {
            // Tenta encontrar pelo ícone de telefone
            const btns = Array.from(document.querySelectorAll('button[data-item-id*="phone"], [data-tooltip*="telefone"], [aria-label*="telefone"], [aria-label*="Telefone"]'));
            for (const btn of btns) {
              const txt = btn.getAttribute('aria-label') || btn.getAttribute('data-item-id') || '';
              const match = txt.match(/(\+?[\d\s\-().]{8,})/);
              if (match) { telefone = match[1].trim(); break; }
            }
          }

          // Endereço
          const enderecoEl =
            document.querySelector('button[data-item-id*="address"]') ||
            document.querySelector('[data-item-id="address"]') ||
            document.querySelector('[aria-label*="Endereço"]');
          const endereco = enderecoEl?.getAttribute('aria-label')?.replace('Endereço:', '').trim() ||
            enderecoEl?.innerText?.trim() || '';

          return { nome: nome.trim(), telefone: telefone.trim(), endereco };
        });

        await detailPage.close();

        if (dados.nome && dados.telefone) {
          dados._link = link;
          empresas.push(dados);
          console.log(`[${empresas.length}/${limit}] ${dados.nome} — ${dados.telefone}`);
        } else if (dados.nome) {
          console.log(`Sem telefone: ${dados.nome}`);
        }
      } catch (err) {
        console.log(`Erro ao acessar detalhe: ${err.message}`);
      }
    }

    if (empresas.length >= limit) break;

    // Scroll para carregar mais resultados
    const antes = links.length;
    await page.evaluate(() => {
      const feed = document.querySelector('[role="feed"]');
      if (feed) feed.scrollTop += 1000;
      else window.scrollBy(0, 1000);
    });
    await page.waitForTimeout(3000);

    const depois = await page.evaluate(() =>
      document.querySelectorAll('a[href*="/maps/place/"]').length
    );

    if (depois <= antes) {
      semNovas++;
      if (semNovas >= 3) { console.log('Sem mais resultados.'); break; }
    } else {
      semNovas = 0;
    }
  }

  await browser.close();

  // Remove campo interno _link antes de retornar
  const resultado = empresas.map(({ _link, ...rest }) => rest);
  console.log(`Scraping concluído. ${resultado.length} empresas com telefone encontradas.`);
  return resultado;
}

module.exports = { scrapeGoogleMaps };
