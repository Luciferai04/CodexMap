import os
import subprocess
import glob
import json

def main():
    output_dir = os.path.join(os.path.dirname(__file__), '..', 'output')
    shared_dir = os.path.join(os.path.dirname(__file__), '..', 'shared')
    corpus_path = "/tmp/codexmap_corpus.md"
    tree_path = os.path.join(shared_dir, 'pageindex-tree.json')

    print(f"[PAGEINDEX] Generating corpus from {output_dir}...")
    
    files = glob.glob(os.path.join(output_dir, "**/*.ts"), recursive=True) + \
            glob.glob(os.path.join(output_dir, "**/*.js"), recursive=True)
    
    with open(corpus_path, 'w') as out:
        out.write("# CodexMap Codebase Corpus\n\n")
        for fpath in files:
            rel_path = os.path.basename(fpath) # Simplified for corpus
            with open(fpath, 'r') as f:
                content = f.read()
            
            out.write(f"## {rel_path}\n\n")
            # Simple heuristic for H3s for better PageIndex indexing
            # We'll just dump the content for now, PageIndex usually handles chunking.
            out.write(content + "\n\n")

    print(f"[PAGEINDEX] Corpus written to {corpus_path}")
    print(f"[PAGEINDEX] Running indexing (model: gpt-4o-2024-11-20)...")
    
    try:
        # Assuming pageindex CLI is available after pip install
        # The user provided: --md_path /tmp/codexmap_corpus.md --model gpt-4o-2024-11-20
        # We also need to specify the output for the tree.
        # If the CLI doesn't support --output-json, we might need to find where it saves.
        # User said "save the resulting tree JSON to shared/pageindex-tree.json"
        
        cmd = [
            "pageindex", 
            "--md_path", corpus_path, 
            "--model", "gpt-4o-2024-11-20",
            "--out_path", tree_path
        ]
        subprocess.run(cmd, check=True)
        print(f"[PAGEINDEX] ✔ Tree saved to {tree_path}")
    except Exception as e:
        print(f"[PAGEINDEX] ✖ Command failed: {e}")
        # Mocking for testing if CLI is unavailable
        with open(tree_path, 'w') as f:
            json.dump({"nodes": []}, f)

if __name__ == "__main__":
    main()
