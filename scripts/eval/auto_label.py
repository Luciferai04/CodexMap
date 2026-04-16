import json
import os
import sys
from openai import OpenAI

def main():
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    
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
    ground_truth = {}
    
    if os.path.exists(gt_path):
        with open(gt_path, 'r') as f:
            ground_truth = json.load(f)

    print(f"--- Automated Labeling Tool ---")
    print(f"Prompt: {prompt}")
    print(f"Processing {len(nodes)} nodes...")

    for node in nodes:
        node_id = node['id']
        if node_id in ground_truth:
            continue

        print(f"  Labeling {node_id}...", end="", flush=True)
        
        content = f"ID: {node_id}\nPATH: {node.get('path', 'N/A')}\nCODE:\n{node.get('code', '')[:2000]}"
        
        system_prompt = (
            "You are a Senior Software Architect. Your task is to determine if a given code node (file or function) "
            "is 'ON-SCOPE' for a specific user prompt. \n"
            "Respond with exactly one character: '1' for ON-SCOPE, '0' for OFF-SCOPE.\n"
            "Criteria for ON-SCOPE (1):\n"
            "- It implements a core feature described in the prompt.\n"
            "- It is a necessary architectural component (route, auth, database) for the prompt.\n"
            "Criteria for OFF-SCOPE (0):\n"
            "- It is a boilerplate file unrelated to the prompt.\n"
            "- It belongs to a different project or an unrelated feature.\n"
            "- It is a test file or a helper that is not explicitly requested."
        )

        user_msg = f"PROMPT: {prompt}\n\nNODE CONTENT:\n{content}"

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg}
            ],
            temperature=0,
            max_tokens=1
        )
        
        label = response.choices[0].message.content.strip()
        if label in ('1', '0'):
            ground_truth[node_id] = int(label)
            print(f" [{label}]")
        else:
            print(" [ERROR]")

    with open(gt_path, 'w') as f:
        json.dump(ground_truth, f, indent=2)
    print(f"\nSaved {len(ground_truth)} labels to ground_truth.json")

if __name__ == "__main__":
    main()
