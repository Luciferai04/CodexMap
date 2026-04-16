import json
import os
import time
import requests
import websocket
import threading

SHARED_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'shared')
MAP_STATE_PATH = os.path.join(SHARED_DIR, 'map-state.json')
REHEAL_URL = "http://localhost:3333/reheal"
WS_URL = "ws://localhost:4242"

completed_nodes = {}
cv = threading.Condition()

def on_message(ws, message):
    msg = json.loads(message)
    if msg['type'] == 'heal_complete':
        node_id = msg['payload']['nodeId']
        print(f"Heal complete received for {node_id}")
        with cv:
            completed_nodes[node_id] = True
            cv.notify_all()

def main():
    # 1. Connect WS
    ws = websocket.WebSocketApp(WS_URL, on_message=on_message)
    wst = threading.Thread(target=ws.run_forever)
    wst.daemon = True
    wst.start()
    time.sleep(1) # wait for connection

    # 2. Get 5 lowest-scoring nodes
    if not os.path.exists(MAP_STATE_PATH):
        print("Map state not found")
        return

    with open(MAP_STATE_PATH, 'r') as f:
        state = json.load(f)
    
    nodes = state.get('nodes', [])
    # Sort by score ascending (lowest score = reddest)
    red_nodes = [n for n in nodes if n.get('score') is not None]
    red_nodes.sort(key=lambda x: x['score'])
    targets = red_nodes[:5]

    if not targets:
        print("No reddened nodes found to heal.")
        return

    print(f"\n--- Healing Evaluation (N={len(targets)}) ---")
    before_scores = {n['id']: n['score'] for n in targets}

    # 3. Trigger Healing
    for n in targets:
        node_id = n['id']
        print(f"Requesting heal for {node_id} (Before: {before_scores[node_id]:.4f})")
        try:
            r = requests.post(REHEAL_URL, json={'nodeId': node_id})
            r.raise_for_status()
        except Exception as e:
            print(f"POST failed for {node_id}: {e}")

    # 4. Wait for all
    print("Waiting for all heal_complete signals...")
    with cv:
        success = cv.wait_for(lambda: all(n['id'] in completed_nodes for n in targets), timeout=120)

    if not success:
        print("Timeout waiting for healing completion.")
        # Continue anyway to show what we have

    # 5. Record results
    time.sleep(5) # Wait for sentinel to re-score
    with open(MAP_STATE_PATH, 'r') as f:
        new_state = json.load(f)
    new_node_map = {n['id']: n for n in new_state['nodes']}

    print("\n" + "="*70)
    print(f"{'Node ID':25} | Before | After  | Delta")
    print("-" * 70)

    deltas = []
    for n in targets:
        nid = n['id']
        after = new_node_map.get(nid, {}).get('score', 0)
        before = before_scores[nid]
        delta = after - before
        deltas.append(delta)
        print(f"{nid:25} | {before:6.4f} | {after:6.4f} | {delta:+.4f}")

    mean_delta = sum(deltas)/len(deltas) if deltas else 0
    print("-" * 70)
    print(f"MEAN DELTA: {mean_delta:+.4f}")

    if mean_delta > 0.15:
        print("✅ Success: Mean delta > 0.15")
    else:
        print("❌ Failure: Mean delta <= 0.15")
        exit(1)

if __name__ == "__main__":
    main()
