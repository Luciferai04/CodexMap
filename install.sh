#!/bin/bash
set -e

echo ""
echo "╔═══════════════════════════════════╗"
echo "║   CodexMap — Install              ║"
echo "╚═══════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org (v18+)"
  exit 1
fi
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js v18+ required (found v$NODE_VER)"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# Check Python
if ! command -v python3 &> /dev/null; then
  echo "❌ Python 3.9+ not found"
  exit 1
fi
echo "✅ Python $(python3 --version)"

# Check Codex CLI
if ! command -v codex &> /dev/null; then
  echo "⚠  Codex CLI not found. Installing..."
  npm install -g @openai/codex
fi
echo "✅ Codex CLI $(codex --version 2>/dev/null || echo 'installed')"

# Install Node deps
echo "📦 Installing Node.js dependencies..."
npm install --silent

# Install Python deps
echo "🐍 Installing Python dependencies..."
pip install -r requirements.txt --quiet --break-system-packages 2>/dev/null \
  || pip install -r requirements.txt --quiet

# Create .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "⚠  Created .env — add your OpenAI API key:"
  echo "   OPENAI_API_KEY=sk-..."
  echo ""
fi

# Create required directories
mkdir -p output shared docs

# Create shared state files if missing
[ -f shared/map-state.json ]       || echo '{"nodes":[],"edges":[]}' > shared/map-state.json
[ -f shared/session-drift-log.json ] || echo '[]' > shared/session-drift-log.json

echo ""
echo "╔═══════════════════════════════════╗"
echo "║   ✅ CodexMap ready!              ║"
echo "║                                   ║"
echo "║   Add OPENAI_API_KEY to .env      ║"
echo "║   then run:                       ║"
echo "║                                   ║"
echo "║   npm start 'your prompt here'    ║"
echo "╚═══════════════════════════════════╝"
echo ""
