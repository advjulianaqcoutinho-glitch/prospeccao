'use strict';

const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  ws.on('error', (err) => {
    console.error('[WS] client error:', err.message);
  });
});

function broadcast(data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
}

function setupUpgrade(httpServer) {
  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);

    if (pathname === '/' || pathname === '/socket') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });
}

module.exports = { wss, broadcast, setupUpgrade };
