import json
import os
import sys

def main():
    shared_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'shared')
    map_state_path = os.path.join(shared_dir, 'map-state.json')
    gt_path = os.path.join(os.path.dirname(__file__), 'ground_truth.json')

    if not os.path.exists(map_state_path):
        print(f"Error: {map_state_path} not found.")
        return

    with open(map_state_path, 'r') as f:
        data = json.load(f)

    nodes = data.get('nodes', [])
    ground_truth = {}
    
    if os.path.exists(gt_path):
        with open(gt_path, 'r') as f:
            ground_truth = json.load(f)

    print(f"--- Node Labeling Tool ---")
    print(f"Found {len(nodes)} nodes. press Ctrl+C to stop and save.")

    try:
        for node in nodes:
            node_id = node['id']
            if node_id in ground_truth:
                continue

            print("\n" + "="*60)
            print(f"NODE ID: {node_id}")
            print(f"PATH:    {node.get('path', 'N/A')}")
            print("-" * 20)
            
            code = node.get('code', '')
            lines = code.splitlines()[:15]
            for i, line in enumerate(lines):
                print(f"{i+1:2}: {line}")
            if len(lines) >= 15:
                print("...")

            while True:
                val = input("\nIs this node ON-SCOPE? (1=Yes, 0=No): ").strip()
                if val in ('1', '0'):
                    ground_truth[node_id] = int(val)
                    break
                else:
                    print("Invalid input. Enter 1 or 0.")
    except KeyboardInterrupt:
        print("\nInterrupted. Saving progress...")

    with open(gt_path, 'w') as f:
        json.dump(ground_truth, f, indent=2)
    print(f"Saved {len(ground_truth)} labels to ground_truth.json")

if __name__ == "__main__":
    main()
