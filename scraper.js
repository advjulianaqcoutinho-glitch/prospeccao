const puppeteer = require('puppeteer');

async function scrapeGoogleMaps(nicho, cidade, limit = 10) {
  console.log(`Iniciando scraping para "${nicho}" em "${cidade}"...`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  const query = encodeURIComponent(`${nicho} ${cidade}`);
  await page.goto(`https://www.google.com/maps/search/${query}`, {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  let empresas = [];
  let semNovasEmpresas = 0;
  const MAX_SEM_NOVAS = 3;

  while (empresas.length < limit) {
    await page.waitForTimeout(2000);

    const results = await page.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll('div[jsaction*="mouseover:pane"]')
      );
      return items.map(item => {
        const nome = item.querySelector('.fontHeadlineSmall')?.innerText || '';
        const telefone =
          item.querySelector('a[href^="tel:"]')?.href.replace('tel:', '') || '';
        const endereco =
          item.querySelector('.fontBodyMedium')?.innerText?.split('\n')[0] || '';
        return { nome, telefone, endereco };
      });
    });

    const antes = empresas.length;
    for (const empresa of results) {
      if (
        empresa.nome &&
        empresa.telefone &&
        empresas.length < limit &&
        !empresas.find(e => e.telefone === empresa.telefone)
      ) {
        empresas.push(empresa);
      }
    }

    if (empresas.length === antes) {
      semNovasEmpresas++;
      if (semNovasEmpresas >= MAX_SEM_NOVAS) {
        console.log('Sem novos resultados. Encerrando scroll.');
        break;
      }
    } else {
      semNovasEmpresas = 0;
    }

    const fimDaLista = await page.evaluate(() => {
      const endMessage = document.querySelector('.Hk4XGb');
      return endMessage !== null;
    });

    if (fimDaLista) {
      console.log('Fim da lista de resultados do Google Maps.');
      break;
    }

    await page.evaluate(() => {
      const scrollable = document.querySelector('div[role="feed"]');
      if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
    });
  }

  await browser.close();
  console.log(`Scraping concluído. Encontradas ${empresas.length} empresas.`);
  return empresas;
}

module.exports = { scrapeGoogleMaps };
