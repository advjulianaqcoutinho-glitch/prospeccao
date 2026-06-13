#!/bin/bash
set -e

echo "=== Prospector Deploy ==="

# Carrega variáveis do .env
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
else
  echo "ERRO: arquivo .env não encontrado. Copie .env.example para .env e preencha as variáveis."
  exit 1
fi

echo "[1/4] Build da imagem Docker..."
docker build -t prospector-api:latest .

echo "[2/4] Iniciando Docker Swarm (se necessário)..."
docker info | grep -q "Swarm: active" || docker swarm init

echo "[3/4] Deploy do stack..."
docker stack deploy -c docker-compose.yml prospector --with-registry-auth

echo "[4/4] Verificando serviços..."
sleep 5
docker stack services prospector

echo ""
echo "✅ Deploy concluído!"
echo "   Frontend: http://$(hostname -I | awk '{print $1}')"
echo "   API:      http://$(hostname -I | awk '{print $1}')/api/stats"
