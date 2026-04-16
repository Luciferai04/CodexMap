import json
import os

def main():
    shared_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'shared')
    map_state_path = os.path.join(shared_dir, 'map-state.json')
    gt_path = os.path.join(os.path.dirname(__file__), 'ground_truth.json')

    if not os.path.exists(gt_path):
        print(f"Error: Ground truth file '{gt_path}' not found. Run label_nodes.py first.")
        return
    if not os.path.exists(map_state_path):
        print(f"Error: map-state.json not found.")
        return

    with open(gt_path, 'r') as f:
        ground_truth = json.load(f)
    with open(map_state_path, 'r') as f:
        map_state = json.load(f)

    nodes = map_state.get('nodes', [])
    
    tp = 0 # True Positives (GT=1, Sentinel=green)
    fp = 0 # False Positives (GT=0, Sentinel=green)
    fn = 0 # False Negatives (GT=1, Sentinel!=green)
    tn = 0 # True Negatives (GT=0, Sentinel!=green)

    total_matched = 0
    for node in nodes:
        nid = node['id']
        if nid not in ground_truth:
            continue
        
        total_matched += 1
        gt = ground_truth[nid]
        # Sentinel Grade: green=1, yellow/red=0
        pred = 1 if node.get('grade') == 'green' else 0

        if gt == 1 and pred == 1: tp += 1
        elif gt == 0 and pred == 1: fp += 1
        elif gt == 1 and pred == 0: fn += 1
        elif gt == 0 and pred == 0: tn += 1

    print(f"\n--- Accuracy Metrics (N={total_matched}) ---")
    if total_matched == 0:
        print("No nodes matched between map-state and ground truth.")
        return

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0

    print(f"Precision: {precision:.4f}")
    print(f"Recall:    {recall:.4f}")
    print(f"F1 Score:  {f1:.4f}")
    print(f"\nConfusion Matrix:")
    print(f"   Pred: 1   Pred: 0")
    print(f"GT: 1  [{tp:4}]   [{fn:4}]")
    print(f"GT: 0  [{fp:4}]   [{tn:4}]")

if __name__ == "__main__":
    main()
