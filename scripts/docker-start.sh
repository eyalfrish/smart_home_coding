#!/bin/bash
# Smart Home Dashboard - Docker Start Script
# This script builds (if needed) and starts the dashboard container

echo "============================================"
echo "  Smart Home Dashboard - Docker Start"
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

echo "Docker is running. Starting dashboard..."
echo ""

if ! docker compose up -d --build; then
    echo ""
    echo "ERROR: Failed to start the dashboard!"
    exit 1
fi

echo ""
echo "============================================"
echo "  Dashboard started successfully!"
echo "  Access it at: http://localhost:3000"
echo "============================================"
echo ""
echo "The container will auto-restart after reboot."
echo ""
echo "Useful commands:"
echo "  - View logs:    docker compose logs -f"
echo "  - Stop:         docker compose down"
echo "  - Restart:      docker compose restart"
echo ""

