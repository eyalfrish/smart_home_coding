#!/bin/bash
# Smart Home Dashboard - Docker Status Script

echo "============================================"
echo "  Smart Home Dashboard - Status"
echo "============================================"
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

echo "Container Status:"
echo "-----------------"
docker compose ps

echo ""
echo "Container Health:"
echo "-----------------"
docker inspect --format="{{.State.Health.Status}}" smart-home-dashboard 2>/dev/null || echo "Container not running"

echo ""
echo "Resource Usage:"
echo "---------------"
docker stats smart-home-dashboard --no-stream 2>/dev/null || echo "Container not running"

echo ""

