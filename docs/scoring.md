# Scoring Formula

The CodexMap scoring system calculates a final semantic alignment score (S_final) for every AST node using a hybrid weighted formula:

`S_final = 0.2·S1 + 0.4·S2 + 0.2·A + 0.2·T − 0.3·D`

## Components

* **S1: Cosine Similarity** - Text embeddings comparison between the node code and the prompt.
* **S2: PageIndex Score** - Vectorless RAG-based reasoning score evaluated by an LLM.
* **A: Architectural Consistency** - Evaluates correct structural dependencies with verified green nodes.
* **T: Type Consistency** - Checks type enforcement aligned to the domain parameters.
* **D: Drift Penalty** - Deduction for identified anti-patterns and loose imports.
