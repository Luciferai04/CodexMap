import json
import os
import re
from openai import OpenAI

def main():
    shared_dir = os.path.join(os.path.dirname(__file__), '..', 'shared')
    tree_path = os.path.join(shared_dir, 'pageindex-tree.json')
    scores_path = os.path.join(shared_dir, 'pageindex-scores.json')
    prompt_path = os.path.join(shared_dir, 'prompt.txt')

    if not os.path.exists(tree_path):
        print("Error: pageindex-tree.json not found")
        return
    with open(prompt_path, 'r') as f:
        dev_prompt = f.read().strip()

    with open(tree_path, 'r') as f:
        tree = json.load(f)

    # Note: PageIndex tree structure has 'nodes' list.
    # Leaf nodes are those with no children or specific depth.
    # We'll process all nodes that have a 'summary'.
    nodes = tree.get('nodes', [])
    
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    scores = {}

    print(f"[PAGEINDEX-SCORE] Scoring {len(nodes)} structural sections...")

    for node in nodes:
        node_id = node.get('node_id')
        title = node.get('title', '')
        summary = node.get('summary', '')
        
        if not summary or not node_id: continue

        print(f"  Scoring section: {title}...")
        
        try:
            response = client.chat.completions.create(
                model="gpt-4o-2024-11-20",
                messages=[
                    {"role": "system", "content": "You are a code architecture judge. Score 0.0-1.0 how relevant this code section is to the prompt. Respond with ONLY the float number."},
                    {"role": "user", "content": f"Prompt: {dev_prompt}\n\nCode section title: {title}\nSummary: {summary}"}
                ],
                temperature=0
            )
            
            raw_val = response.choices[0].message.content.strip()
            # Extract float
            match = re.search(r"(\d+\.\d+|\d+)", raw_val)
            score = float(match.group(1)) if match else 0.0
            scores[node_id] = min(1.0, max(0.0, score))
        except Exception as e:
            print(f"  ✖ Failed to score {node_id}: {e}")
            scores[node_id] = 0.5

    with open(scores_path, 'w') as f:
        json.dump(scores, f, indent=2)
    
    print(f"[PAGEINDEX-SCORE] ✔ Results saved to pageindex-scores.json")

if __name__ == "__main__":
    main()
