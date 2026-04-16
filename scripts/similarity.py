#!/usr/bin/env python3
"""
scripts/similarity.py — Cosine similarity scorer
Built by @Somu.ai for the OpenAI Codex Hackathon 2025

Accepts two JSON arrays from stdin (one per line), computes cosine
similarity using numpy, and prints the float result to stdout.
Guards against zero-norm vectors (returns 0.0 instead of NaN).

Usage:
    echo '[0.1, 0.2, 0.3]
    [0.4, 0.5, 0.6]' | python scripts/similarity.py
"""

import sys
import json
import numpy as np


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors.
    Returns 0.0 for zero-norm vectors to avoid NaN."""
    a_arr = np.array(a, dtype=np.float64)
    b_arr = np.array(b, dtype=np.float64)

    norm_a = np.linalg.norm(a_arr)
    norm_b = np.linalg.norm(b_arr)

    # Guard against zero-norm vectors
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0

    return float(np.dot(a_arr, b_arr) / (norm_a * norm_b))


if __name__ == "__main__":
    lines = sys.stdin.read().strip().split('\n')
    if len(lines) < 2:
        print("Error: Expected two JSON arrays, one per line", file=sys.stderr)
        sys.exit(1)

    try:
        vec_a = json.loads(lines[0])
        vec_b = json.loads(lines[1])
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON input: {e}", file=sys.stderr)
        sys.exit(1)

    result = cosine_similarity(vec_a, vec_b)
    print(result)
