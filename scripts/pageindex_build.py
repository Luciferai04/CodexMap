import sys
import os
import json
import openai
from pathlib import Path

# PageIndex RAG Engine - Architectural Intelligence
# Built by @Somu.ai for CodexMap

client = openai.OpenAI()

def summarize_component(path, code, prompt):
    """Generates a concise architectural summary and relevance score."""
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a senior architect. Analyze this component and determine its relevance to the prompt (0.0 to 1.0). Provide a 1-sentence summary."},
                {"role": "user", "content": f"Prompt: {prompt}\nPath: {path}\nCode Snippet: {code[:1000]}"}
            ],
            response_format={ "type": "json_object" }
        )
        # Expecting JSON: { "relevance": 0.85, "summary": "..." }
        data = json.loads(response.choices[0].message.content)
        return data.get("relevance", 0.5), data.get("summary", "Architectural component identified.")
    except Exception as e:
        print(f"Error summarizing {path}: {e}")
        return 0.5, "Error during analysis."

def build_pageindex(source_dir, prompt):
    tree = {"nodes": [], "prompt": prompt}
    source_path = Path(source_dir)
    
    # Traverse only meaningful files
    extensions = {'.js', '.ts', '.py', '.go', '.java', '.c', '.cpp'}
    
    for file_path in source_path.rglob('*'):
        if file_path.suffix in extensions:
            rel_path = str(file_path.relative_to(source_path))
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    code = f.read()
                
                print(f"Analyzing {rel_path}...")
                relevance, summary = summarize_component(rel_path, code, prompt)
                
                tree["nodes"].append({
                    "node_id": rel_path,
                    "title": file_path.name,
                    "summary": summary,
                    "relevance_score": relevance
                })
            except Exception as e:
                print(f"Failed to read {rel_path}: {e}")
                
    return tree

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python pageindex_build.py <dir> <prompt>")
        sys.exit(1)
        
    source_dir = sys.argv[1]
    prompt = sys.argv[2]
    
    tree = build_pageindex(source_dir, prompt)
    
    output_path = Path(__file__).parent.parent / "shared" / "pageindex-tree.json"
    with open(output_path, "w", encoding='utf-8') as f:
        json.dump(tree, f, indent=2)
    
    print(f"PAGEINDEX_BUILD_SUCCESS: {len(tree['nodes'])} nodes mapped and summarized.")
