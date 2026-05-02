#!/usr/bin/env python3
"""
scripts/embed.py — OpenAI embeddings wrapper (text-embedding-3-small)
Built by @Somu.ai for the OpenAI Codex Hackathon 2025

Accepts text via stdin, truncates to 8000 chars, calls OpenAI
text-embedding-3-small, tracks cost, and prints the embedding as a JSON array to stdout.
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

client = OpenAI()

# Cost tracking
COST_LOG = './shared/api-cost.json'
EMBEDDING_COST_PER_1K_TOKENS = 0.00002  # text-embedding-3-small

def load_cost_log():
    try: return json.load(open(COST_LOG))
    except: return { 'total_tokens': 0, 'total_cost_usd': 0, 
                     'calls': 0, 'session_start': None }

def save_cost_log(log):
    tmp = COST_LOG + '.tmp'
    json.dump(log, open(tmp, 'w'), indent=2)
    os.rename(tmp, COST_LOG)

def embed_with_cost_tracking(text, model='text-embedding-3-small'):
    log = load_cost_log()
    if not log['session_start']:
        log['session_start'] = time.strftime('%Y-%m-%dT%H:%M:%SZ')
    
    # Enforce per-session cost cap ($2 default, configurable)
    cost_cap = float(os.getenv('CODEXMAP_COST_CAP_USD', '2.0'))
    if log['total_cost_usd'] >= cost_cap:
        print(f'[Embed] Cost cap ${cost_cap} reached. Skipping embed.', file=sys.stderr)
        return None
    
    # Retry on rate limit with exponential backoff
    for attempt in range(5):
        try:
            resp = client.embeddings.create(
                model=model,
                input=text[:8000]
            )
            tokens = resp.usage.total_tokens
            cost = (tokens / 1000) * EMBEDDING_COST_PER_1K_TOKENS
            
            log['total_tokens'] += tokens
            log['total_cost_usd'] = round(log['total_cost_usd'] + cost, 6)
            log['calls'] += 1
            save_cost_log(log)
            
            print(f'[Embed] tokens={tokens} cost=${cost:.5f} '
                  f'session_total=${log["total_cost_usd"]:.4f}', file=sys.stderr)
            return resp.data[0].embedding
            
        except RateLimitError:
            wait = (2 ** attempt) * 1.5
            print(f'[Embed] Rate limited, waiting {wait}s...', file=sys.stderr)
            time.sleep(wait)
        except Exception as e:
            print(f'[Embed] Error: {e}', file=sys.stderr)
            return None
    return None

if __name__ == "__main__":
    text = sys.stdin.read()
    if not text.strip():
        print("Error: No text provided on stdin", file=sys.stderr)
        sys.exit(1)
    
    embedding = embed_with_cost_tracking(text)
    if embedding:
        print(json.dumps(embedding))
    else:
        # Provide empty valid array to avoid JSON parse errors
        print("[]")
