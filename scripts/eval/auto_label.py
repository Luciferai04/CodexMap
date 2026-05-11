import json
import os
import sys
import time
from openai import OpenAI

def main():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY not set in environment.")
        sys.exit(1)

    client = OpenAI(api_key=api_key)

    shared_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'shared')
    map_state_path = os.path.join(shared_dir, 'map-state.json')
    prompt_path = os.path.join(shared_dir, 'prompt.txt')
    gt_path = os.path.join(os.path.dirname(__file__), 'ground_truth.json')

    if not os.path.exists(map_state_path):
        print(f"Error: {map_state_path} not found.")
        return

    with open(prompt_path, 'r') as f:
        prompt = f.read().strip()

    with open(map_state_path, 'r') as f:
        data = json.load(f)

    nodes = data.get('nodes', [])
    # Filter to only label file/function nodes (skip directories and tiny blocks)
    labelable = [n for n in nodes if n.get('type') in ('file', 'function') and len(n.get('code', '')) >= 20]

    ground_truth = {}
    if os.path.exists(gt_path):
        with open(gt_path, 'r') as f:
            ground_truth = json.load(f)

    print(f"--- Automated Labeling Tool ---")
    print(f"Prompt: {prompt}")
    print(f"Total nodes: {len(nodes)}, Labelable: {len(labelable)}, Already labeled: {len(ground_truth)}")

    success_count = 0
    fail_count = 0
    skip_count = 0

    for node in labelable:
        node_id = node['id']
        if node_id in ground_truth:
            skip_count += 1
            continue

        # Increased context window from 2000 to 4000 chars
        content_text = f"ID: {node_id}\nPATH: {node.get('path', 'N/A')}\nTYPE: {node.get('type', 'unknown')}\nCODE:\n{node.get('code', '')[:4000]}"

        system_prompt = (
            "You are a Senior Software Architect evaluating code nodes for scope relevance.\n"
            "Determine if this code node is 'ON-SCOPE' (1) or 'OFF-SCOPE' (0) for the user prompt.\n"
            "Respond with EXACTLY one character: '1' or '0'. Nothing else.\n\n"
            "ON-SCOPE (1) criteria:\n"
            "- Implements a core feature described in the prompt\n"
            "- Is a necessary architectural component (route, auth, database, API) for the prompt\n"
            "- Contains domain-relevant logic matching the prompt\n\n"
            "OFF-SCOPE (0) criteria:\n"
            "- Boilerplate file unrelated to the prompt\n"
            "- Belongs to a different project or unrelated feature\n"
            "- Test file or helper not explicitly requested\n"
            "- Deliberately contaminated/drifted code"
        )

        user_msg = f"PROMPT: {prompt}\n\nNODE CONTENT:\n{content_text}"

        max_retries = 3
        labeled = False
        for attempt in range(max_retries):
            try:
                response = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_msg}
                    ],
                    temperature=0,
                    max_tokens=5
                )

                label = response.choices[0].message.content.strip().rstrip('.').strip()
                if label in ('1', '0'):
                    ground_truth[node_id] = int(label)
                    onoff = "ON-SCOPE" if int(label) == 1 else "OFF-SCOPE"
                    print(f"  [{node_id}] [{label}] {onoff}")
                    success_count += 1
                    labeled = True
                    break
                else:
                    print(f"  [{node_id}] [unexpected: '{label}'] retry {attempt+1}/{max_retries}")
                    if attempt < max_retries - 1:
                        time.sleep(2 ** attempt)
            except Exception as e:
                err_msg = str(e)[:60]
                print(f"  [{node_id}] [error: {err_msg}] retry {attempt+1}/{max_retries}")
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)

        if not labeled:
            fail_count += 1
            print(f"  [{node_id}] [FAILED after {max_retries} attempts]")

        # Rate limiting: 1 second between API calls
        time.sleep(1)

    # Save ground truth
    with open(gt_path, 'w') as f:
        json.dump(ground_truth, f, indent=2)

    print(f"\n{'='*50}")
    print(f"Results: {success_count} labeled, {fail_count} failed, {skip_count} skipped (already had labels)")
    print(f"Total ground truth entries: {len(ground_truth)}")
    print(f"Saved to {gt_path}")

if __name__ == "__main__":
    main()
