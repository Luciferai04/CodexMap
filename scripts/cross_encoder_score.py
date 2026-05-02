import json
import argparse
import os
import math
from sentence_transformers import CrossEncoder

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prompt', required=True)
    parser.add_argument('--candidates-file', required=True)
    args = parser.parse_args()

    shared_dir = os.path.dirname(args.candidates_file)
    output_path = os.path.join(shared_dir, 'cross-encoder-scores.json')

    if not os.path.exists(args.candidates_file):
        print(f"Error: {args.candidates_file} not found")
        return

    with open(args.candidates_file, 'r') as f:
        candidates = json.load(f) # List of { nodeId, code_snippet }

    print(f"[CROSS-ENCODER] Loading model ms-marco-MiniLM-L-6-v2...")
    model = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')

    pairs = []
    node_ids = []
    for c in candidates:
        pairs.append((args.prompt, c['code_snippet'][:2000]))
        node_ids.append(c['nodeId'])

    print(f"[CROSS-ENCODER] Scoring {len(pairs)} candidates...")
    scores = model.predict(pairs)

    results = {}
    for i, score in enumerate(scores):
        # Normalize score (Cross-encoder outputs raw logits often, 
        # but for this specific model it's often -10 to 10 range. 
        # We'll use a simple sigmoid or clipping for 0-1)
        # Note: ms-marco-MiniLM often needs normalization.
        norm_score = 1.0 / (1.0 + math.exp(-score)) 
        results[node_ids[i]] = norm_score

    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"[CROSS-ENCODER] ✔ Written {len(results)} scores to cross-encoder-scores.json")

if __name__ == "__main__":
    main()
