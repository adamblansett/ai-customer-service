#!/usr/bin/env bash
set -e

PORT="${1:-3001}"
echo "=========================================================="
echo "AI Customer Service - Live Carrier Tunnel Setup"
echo "=========================================================="
echo "Target Local Port: ${PORT}"
echo ""

if command -v ngrok &> /dev/null; then
  echo "Using ngrok to expose port ${PORT}..."
  echo "Webhook URLs to configure in carrier consoles:"
  echo "  Voice:    https://<NGROK_DOMAIN>/api/v1/voice/inbound?tenantId=tenant_acme_hvac_001"
  echo "  SMS:      https://<NGROK_DOMAIN>/api/v1/sms/inbound?tenantId=tenant_acme_hvac_001"
  echo "  Email:    https://<NGROK_DOMAIN>/api/v1/email/inbound?tenantId=tenant_acme_hvac_001"
  echo "  WhatsApp: https://<NGROK_DOMAIN>/api/v1/whatsapp/webhook?tenantId=tenant_acme_hvac_001"
  echo ""
  exec ngrok http "${PORT}"
elif command -v cloudflared &> /dev/null; then
  echo "Using Cloudflare Tunnel (cloudflared)..."
  exec cloudflared tunnel --url "http://localhost:${PORT}"
else
  echo "ngrok not found. Launching localtunnel via npx..."
  exec npx localtunnel --port "${PORT}"
fi
