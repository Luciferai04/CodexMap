import json
import os
import subprocess

def count_symbols(filepath):
    # Counts occurrences of "function", "class", and "=>" (arrow functions)
    # Using grep -c as requested
    try:
        cmd = f'grep -Ec "function|class|=>" "{filepath}"'
        res = subprocess.check_output(cmd, shell=True, text=True)
        return int(res.strip())
    except subprocess.CalledProcessError:
        return 0

def main():
    shared_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'shared')
    output_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'output')
    map_state_path = os.path.join(shared_dir, 'map-state.json')

    if not os.path.exists(map_state_path):
        print("Error: map-state.json not found")
        return

    with open(map_state_path, 'r') as f:
        state = json.load(f)

    # Group extracted nodes by file
    # Map from absolute or relative path to count
    extracted_counts = {}
    for node in state.get('nodes', []):
        if node.get('type') == 'function' or '::' in node['id']:
            # It's a derived node. Get parent file path.
            # In our system node['path'] usually points to the file.
            path = node.get('path')
            if path:
                extracted_counts[path] = extracted_counts.get(path, 0) + 1

    print(f"\n--- AST Coverage Report ---")
    files = [f for f in os.listdir(output_dir) if f.endswith(('.ts', '.js'))]
    
    overall_raw = 0
    overall_ext = 0
    
    for f in files:
        fpath = os.path.join(output_dir, f)
        raw_count = count_symbols(fpath)
        
        # Match by filename (Cartographer uses relative paths in node.path usually)
        # Check for both basename and relative path
        ext_count = extracted_counts.get(f, extracted_counts.get(fpath, 0))
        
        coverage = ext_count / raw_count if raw_count > 0 else 1.0
        
        flag = " [!] LOW COVERAGE" if coverage < 0.90 else ""
        print(f"{f:20} | Raw: {raw_count:3} | Extracted: {ext_count:3} | Cov: {coverage:6.1%}{flag}")
        
        overall_raw += raw_count
        overall_ext += ext_count

    mean_coverage = overall_ext / overall_raw if overall_raw > 0 else 1.0
    print("-" * 40)
    print(f"OVERALL MEAN COVERAGE: {mean_coverage:6.1%}")
    if mean_coverage < 0.90:
        print("❌ WARNING: Overall coverage below threshold (0.90)")

if __name__ == "__main__":
    main()
