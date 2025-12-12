#!/bin/bash
# Smart Home Dashboard - Docker Stop Script

echo "============================================"
echo "  Smart Home Dashboard - Docker Stop"
echo "============================================"
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

if docker compose down; then
    echo ""
    echo "Dashboard stopped successfully."
else
    echo ""
    echo "WARNING: There may have been an issue stopping the container."
fi

echo ""

