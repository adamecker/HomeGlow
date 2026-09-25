#!/bin/bash
set -e

# Detect files changed across the working tree, index, and most recent commit
CHANGED_FILES=$(git diff --name-only HEAD~1 2>/dev/null; git status --porcelain | awk '{print $2}')

NEEDS_FRONTEND_BUILD=false
NEEDS_BACKEND_RESTART=false
NEEDS_BACKEND_BUILD=false

if echo "$CHANGED_FILES" | grep -q '^client/'; then
    NEEDS_FRONTEND_BUILD=true
fi

if echo "$CHANGED_FILES" | grep -q '^server/package.*json'; then
    NEEDS_BACKEND_BUILD=true
elif echo "$CHANGED_FILES" | grep -q '^server/'; then
    NEEDS_BACKEND_RESTART=true
fi

if [ "$NEEDS_BACKEND_BUILD" = true ]; then
    echo "📦 Backend dependencies changed -> Rebuilding backend..."
    docker compose up -d --build homeglow-backend
elif [ "$NEEDS_BACKEND_RESTART" = true ]; then
    echo "⚡ Backend code changed -> Restarting backend (1s)..."
    docker compose restart homeglow-backend
fi

if [ "$NEEDS_FRONTEND_BUILD" = true ]; then
    echo "🔨 Frontend code changed -> Building Vite & Nginx container..."
    docker compose up -d --build homeglow-frontend
fi

echo "✅ All required services up to date!"
