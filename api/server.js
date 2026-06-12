require('dotenv').config();
const http = require('http');
const app = require('../src/app');
const { setupUpgrade } = require('../src/ws');
const { init: initCrons } = require('../src/jobs/cronJobs');
const config = require('../src/config');

const server = http.createServer(app);

// 55s timeout — prevents Gateway Timeout (Traefik default is 60s)
server.setTimeout(55000);
server.keepAliveTimeout = 61000;
server.headersTimeout = 62000;

setupUpgrade(server);
initCrons();

server.listen(config.PORT, () => {
  console.log(`Prospector API rodando na porta ${config.PORT}`);
});
