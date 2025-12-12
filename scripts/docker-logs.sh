#!/bin/bash
# Smart Home Dashboard - Docker Logs Script
# Shows live logs from the dashboard container

echo "============================================"
echo "  Smart Home Dashboard - Live Logs"
echo "  Press Ctrl+C to exit"
echo "============================================"
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

docker compose logs -f --tail=100

