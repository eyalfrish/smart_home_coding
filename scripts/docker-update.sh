#!/bin/bash
# Smart Home Dashboard - Docker Update Script
# Use this after pulling new code to rebuild and restart the container

echo "============================================"
echo "  Smart Home Dashboard - Docker Update"
echo "============================================"
echo ""

# Navigate to project root
cd "$(dirname "$0")/.."

echo "Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    echo "ERROR: Docker is not running!"
    echo "Please start Docker Desktop and try again."
    exit 1
fi

echo "Stopping current container..."
docker compose down

echo ""
echo "Rebuilding image (this may take a few minutes)..."
if ! docker compose build --no-cache; then
    echo ""
    echo "ERROR: Build failed!"
    exit 1
fi

echo ""
echo "Starting updated container..."
if ! docker compose up -d; then
    echo ""
    echo "ERROR: Failed to start the container!"
    exit 1
fi

echo ""
echo "============================================"
echo "  Update complete!"
echo "  Dashboard running at: http://localhost:3000"
echo "============================================"
echo ""

# Clean up old images
echo "Cleaning up old Docker images..."
docker image prune -f

echo ""

