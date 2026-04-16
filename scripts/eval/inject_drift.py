import json
import os
import time
import argparse
import random

SHARED_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'shared')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'output')
MAP_STATE_PATH = os.path.join(SHARED_DIR, 'map-state.json')
DRIFT_LOG_PATH = os.path.join(SHARED_DIR, 'session-drift-log.json')

STRIPE_HANDLER = """
/**
 * processes payments via Stripe API
 */
export async function handlePayment(req, res) {
  const { amount, currency, token } = req.body;
  console.log(`Processing payment of ${amount} ${currency}`);
  // Fake stripe call
  return { status: 'success', chargeId: 'ch_' + Math.random().toString(36).substr(2, 9) };
}
"""

def get_drift_score():
    if not os.path.exists(DRIFT_LOG_PATH): return None
    try:
        with open(DRIFT_LOG_PATH, 'r') as f:
            log = json.load(f)
            return log[-1]['score'] if log else None
    except: return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', default='drift_injected.ts')
    parser.add_argument('--scope', choices=['in', 'out'], default='out')
    args = parser.parse_args()

    results = []

    for i in range(10):
        print(f"\n--- Injection Iteration {i+1}/10 ---")
        
        # 1. Capture initial state
        initial_drift = get_drift_score()
        filename = f"drift_{i}_{args.file}"
        filepath = os.path.join(OUTPUT_DIR, filename)
        
        t_start = time.time()
        
        # 2. Inject
        with open(filepath, 'w') as f:
            f.write(STRIPE_HANDLER if args.scope == 'out' else "export function helper() { return 42; }")
        
        print(f"Injected {filename}")
        
        # 3. Poll map-state
        detected_at = None
        node_id = filename # Cartographer uses filename as ID for flat files
        
        for _ in range(12): # 60 seconds
            time.sleep(5)
            if not os.path.exists(MAP_STATE_PATH): continue
            
            with open(MAP_STATE_PATH, 'r') as f:
                state = json.load(f)
            
            node = next((n for n in state['nodes'] if n['id'] == node_id), None)
            if node and node.get('grade') in ('red', 'yellow'):
                detected_at = time.time()
                print(f"Detected! Grade: {node['grade']} Score: {node.get('score')}")
                break
            elif node:
                print(f"Node found, but grade is {node.get('grade')}...")
            else:
                print("Node not in map yet...")

        latency = (detected_at - t_start) if detected_at else None
        final_drift = get_drift_score()
        drift_delta = (initial_drift - final_drift) if (initial_drift and final_drift) else 0
        
        results.append({
            'latency': latency,
            'drift_delta': drift_delta,
            'success': latency is not None
        })
        
        # Clean up
        if os.path.exists(filepath): os.remove(filepath)

    # Summary
    latencies = [r['latency'] for r in results if r['latency'] is not None]
    recall = sum(1 for r in results if r['success']) / 10
    mean_lat = sum(latencies)/len(latencies) if latencies else 0
    
    print("\n" + "="*40)
    print(f"Mean Detection Latency: {mean_lat:.2f}s")
    print(f"Recall:                 {recall:.2%}")
    print(f"Avg Drift Delta:        {sum(r['drift_delta'] for r in results)/10:.2f}")
    print("="*40)

if __name__ == "__main__":
    main()
