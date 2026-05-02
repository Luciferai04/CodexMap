import sys
import os
import json

def get_pageindex_score(node_id):
    tree_path = os.path.join(os.path.dirname(__file__), "..", "shared", "pageindex-tree.json")
    if not os.path.exists(tree_path):
        return 0.5
        
    with open(tree_path, "r") as f:
        data = json.load(f)
        
    for node in data.get("nodes", []):
        if node["node_id"] == node_id:
            return node.get("relevance_score", 0.5)
            
    return 0.5

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
        
    node_id = sys.argv[1]
    print(get_pageindex_score(node_id))
