import json
import os
import math
from rank_bm25 import BM25Okapi

def compute_ndcg(ranked_labels, k=10):
    expected = labels = ranked_labels[:k]
    # DCG
    dcg = sum([l / math.log2(i + 2) for i, l in enumerate(labels)])
    # IDCG (ideal - sorted desc)
    ideal = sorted(ranked_labels, reverse=True)[:k]
    idcg = sum([l / math.log2(i + 2) for i, l in enumerate(ideal)])
    return dcg / idcg if idcg > 0 else 0

def tokenize(text):
    return text.lower().split()

def main():
    shared_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'shared')
    gt_path = os.path.join(os.path.dirname(__file__), 'ground_truth.json')
    map_path = os.path.join(shared_dir, 'map-state.json')
    prompt_path = os.path.join(shared_dir, 'prompt.txt')

    if not os.path.exists(gt_path):
        print("Error: ground_truth.json not found")
        return
    
    with open(gt_path, 'r') as f: gt = json.load(f)
    with open(map_path, 'r') as f: state = json.load(f)
    with open(prompt_path, 'r') as f: prompt = f.read().strip()

    nodes = state.get('nodes', [])[:50]
    corpus = [tokenize(n.get('code', '') + ' ' + n.get('summary', '')) for n in nodes]
    bm25 = BM25Okapi(corpus)
    prompt_tokens = tokenize(prompt)
    
    # 1. Compute Scores
    pure_cosine = []
    hybrid = []
    
    # Simple BM25 normalization helper
    lexical_scores = bm25.get_scores(prompt_tokens)
    max_lex = max(lexical_scores) if len(lexical_scores) > 0 and max(lexical_scores) > 0 else 1
    
    for i, node in enumerate(nodes):
        # We assume node.score currently contains the pure cosine score (S1)
        # or we calculate it. For this benchmark we'll use existing score if it's there.
        s1 = node.get('score', 0) or 0
        s_bm25 = lexical_scores[i] / max_lex
        
        s_hybrid = 0.75 * s1 + 0.25 * s_bm25
        
        label = gt.get(node['id'], 0)
        pure_cosine.append((s1, label))
        hybrid.append((s_hybrid, label))

    # 2. Rank and Compute NDCG
    pure_cosine.sort(key=lambda x: x[0], reverse=True)
    hybrid.sort(key=lambda x: x[0], reverse=True)
    
    ndcg_pure = compute_ndcg([x[1] for x in pure_cosine])
    ndcg_hybrid = compute_ndcg([x[1] for x in hybrid])

    print(f"\n--- Hybrid Benchmark (NDCG@10) ---")
    print(f"Pure Cosine: {ndcg_pure:.4f}")
    print(f"Hybrid:      {ndcg_hybrid:.4f}")
    
    if ndcg_hybrid > ndcg_pure:
        print("✅ Hybrid NDCG > Pure Cosine NDCG")
    else:
        print("❌ Hybrid NDCG <= Pure Cosine NDCG (Baseline is still pending or noise)")

if __name__ == "__main__":
    main()
