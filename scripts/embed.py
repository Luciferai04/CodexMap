#!/usr/bin/env python3
"""
scripts/embed.py — OpenAI embeddings wrapper (text-embedding-3-small)
Built by @Somu.ai for the OpenAI Codex Hackathon 2025

Accepts text via stdin, truncates to 8000 chars, calls OpenAI
text-embedding-3-small, and prints the embedding as a JSON array to stdout.
Retries once on 429 (rate limit). Exits 1 on other errors.

Usage:
    echo "some text" | python scripts/embed.py
"""

import sys
import json
import time
import os

try:
    from openai import OpenAI, RateLimitError, APIError
except ImportError:
    print("Error: openai package not installed. Run: pip install openai", file=sys.stderr)
    sys.exit(1)

# Read OPENAI_API_KEY from env
api_key = os.environ.get("OPENAI_API_KEY")
if not api_key:
    print("Error: OPENAI_API_KEY environment variable not set", file=sys.stderr)
    sys.exit(1)

client = OpenAI(api_key=api_key)


def embed(text: str) -> list[float]:
    """Embed text using OpenAI text-embedding-3-small model."""
    # Truncate to 8000 characters before embedding (model max ~8192 tokens)
    truncated = text[:8000]

    try:
        resp = client.embeddings.create(
            model="text-embedding-3-small",
            input=truncated
        )
        return resp.data[0].embedding
    except RateLimitError:
        # Retry once on 429
        print("Rate limited (429), retrying in 2 seconds...", file=sys.stderr)
        time.sleep(2)
        resp = client.embeddings.create(
            model="text-embedding-3-small",
            input=truncated
        )
        return resp.data[0].embedding
    except (APIError, Exception) as e:
        print(f"Embedding API error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    text = sys.stdin.read()
    if not text.strip():
        print("Error: No text provided on stdin", file=sys.stderr)
        sys.exit(1)
    embedding = embed(text)
    print(json.dumps(embedding))
