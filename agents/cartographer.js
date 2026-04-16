/**
 * agents/cartographer.js — Agent A2: Filesystem watcher → graph JSON
 * Built by @Somu.ai for the OpenAI Codex Hackathon 2025
 *
 * Watches the ./output directory for new/modified files, parses them
 * into a structured graph of nodes and edges, and writes the result
 * to shared/map-state.json atomically.
 */

const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── @babel/parser for JS/TS AST extraction ────────────────────────────────
let babelParser;
try {
  babelParser = require('@babel/parser');
} catch (e) {
  console.error('[CARTOGRAPHER] @babel/parser not installed, JS/TS parsing disabled');
}

// ─── Paths ──────────────────────────────────────────────────────────────────
const watchIdx = process.argv.indexOf('--watch');
const externalWatchPath = watchIdx !== -1 ? process.argv[watchIdx + 1] : null;

const SHARED_DIR = path.join(__dirname, '..', 'shared');
const OUTPUT_DIR = externalWatchPath ? path.resolve(externalWatchPath) : path.join(__dirname, '..', 'output');
const MAP_STATE_PATH = path.join(SHARED_DIR, 'map-state.json');

// ─── Ensure output directory exists ─────────────────────────────────────────
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('[CARTOGRAPHER] Created output/ directory');
}

// ─── Debounce timer ─────────────────────────────────────────────────────────
let debounceTimer = null;
let pendingFiles = new Set();

// ─── Utility: Read JSON safely ──────────────────────────────────────────────
function readJsonSafe(filePath, defaultVal = {}) {
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return defaultVal;
  }
}

// ─── Utility: Atomic JSON write ─────────────────────────────────────────────
function atomicWriteJson(filePath, data) {
  const tmpPath = filePath + '.tmp' + Math.random().toString(36).slice(2);
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ─── Language detection ─────────────────────────────────────────────────────
function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const langMap = {
    '.js': 'javascript', '.jsx': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python', '.rb': 'ruby', '.go': 'go',
    '.rs': 'rust', '.java': 'java', '.c': 'c',
    '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
    '.css': 'css', '.html': 'html', '.json': 'json',
    '.md': 'markdown', '.yaml': 'yaml', '.yml': 'yaml',
    '.sh': 'shell', '.sql': 'sql',
  };
  return langMap[ext] || 'unknown';
}

// ─── Check if file is JS/TS (parseable by Babel) ───────────────────────────
function isBabelParseable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.js', '.jsx', '.ts', '.tsx'].includes(ext);
}

// ─── Compute SHA-256 content hash ───────────────────────────────────────────
function computeContentHash(content) {
  return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
}

// ─── Compute cyclomatic complexity from AST ─────────────────────────────────
function computeCyclomaticComplexity(ast) {
  let complexity = 1; // base complexity

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    // Count branching statements
    switch (node.type) {
      case 'IfStatement':
      case 'ConditionalExpression':
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'SwitchCase':
      case 'CatchClause':
      case 'LogicalExpression':
        if (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||')) {
          complexity++;
        } else if (node.type !== 'LogicalExpression') {
          complexity++;
        }
        break;
    }

    // Recurse into child nodes
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(walk);
      } else if (child && typeof child === 'object' && child.type) {
        walk(child);
      }
    }
  }

  if (ast && ast.program) {
    walk(ast.program);
  }
  return complexity;
}

// ─── Extract functions from AST ─────────────────────────────────────────────
function extractFunctionsFromAST(ast, filePath, fileCode) {
  const functions = [];

  function walk(node, parentPath) {
    if (!node || typeof node !== 'object') return;

    let funcName = null;
    let funcCode = '';

    switch (node.type) {
      case 'FunctionDeclaration':
        funcName = node.id ? node.id.name : 'anonymous';
        funcCode = fileCode.slice(node.start, node.end);
        break;
      case 'ArrowFunctionExpression':
        // Check if parent is a variable declarator
        if (parentPath && parentPath.type === 'VariableDeclarator' && parentPath.id) {
          funcName = parentPath.id.name;
        } else {
          funcName = 'arrow_anonymous';
        }
        funcCode = fileCode.slice(node.start, node.end);
        break;
      case 'MethodDefinition':
        funcName = node.key ? (node.key.name || node.key.value || 'method') : 'method';
        funcCode = fileCode.slice(node.start, node.end);
        break;
      case 'FunctionExpression':
        if (parentPath && parentPath.type === 'VariableDeclarator' && parentPath.id) {
          funcName = parentPath.id.name;
        } else if (node.id) {
          funcName = node.id.name;
        }
        if (funcName) {
          funcCode = fileCode.slice(node.start, node.end);
        }
        break;
    }

    if (funcName) {
      // Stable ID: file path + function name (NOT line numbers per SKILL.md)
      const funcId = `${filePath}::${funcName}`;
      functions.push({
        id: funcId,
        label: `${funcName}()`,
        type: 'function',
        path: filePath,
        language: detectLanguage(filePath),
        summary: '',
        code: funcCode.slice(0, 2000), // cap code size
        score: null,
        grade: 'pending',
        contentHash: computeContentHash(funcCode),
        cyclomaticComplexity: null,
        children: [],
        lastUpdated: new Date().toISOString(),
      });
    }

    // Recurse into child nodes
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(c => walk(c, node));
      } else if (child && typeof child === 'object' && child.type) {
        walk(child, node);
      }
    }
  }

  if (ast && ast.program) {
    walk(ast.program, null);
  }
  return functions;
}

// ─── Parse imports from AST for edge building ───────────────────────────────
function extractImports(ast, filePath) {
  const imports = [];
  if (!ast || !ast.program) return imports;

  for (const node of ast.program.body) {
    // ES6 import
    if (node.type === 'ImportDeclaration' && node.source) {
      imports.push(node.source.value);
    }
    // CommonJS require
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.init && decl.init.type === 'CallExpression') {
          const callee = decl.init.callee;
          if (callee && callee.name === 'require' && decl.init.arguments.length > 0) {
            const arg = decl.init.arguments[0];
            if (arg.type === 'StringLiteral' || arg.type === 'Literal') {
              imports.push(arg.value);
            }
          }
        }
      }
    }
  }
  return imports;
}

// ─── Line-based fallback parser for non-JS/TS files ────────────────────────
function parseFileLineBased(filePath, content) {
  const functions = [];
  const lines = content.split('\n');
  const language = detectLanguage(filePath);

  // Python: def function_name(
  // Ruby: def method_name
  // Go: func funcName(
  const patterns = [
    { lang: 'python', regex: /^\s*def\s+(\w+)\s*\(/, type: 'function' },
    { lang: 'python', regex: /^\s*class\s+(\w+)/, type: 'class' },
    { lang: 'ruby', regex: /^\s*def\s+(\w+)/, type: 'function' },
    { lang: 'go', regex: /^func\s+(\w+)\s*\(/, type: 'function' },
    { lang: 'rust', regex: /^\s*(?:pub\s+)?fn\s+(\w+)/, type: 'function' },
    { lang: 'java', regex: /^\s*(?:public|private|protected)?\s*(?:static\s+)?\w+\s+(\w+)\s*\(/, type: 'function' },
    { lang: 'c', regex: /^\w[\w\s\*]+\s+(\w+)\s*\(/, type: 'function' },
  ];

  lines.forEach((line, idx) => {
    for (const pattern of patterns) {
      if (language === pattern.lang || language === 'unknown') {
        const match = line.match(pattern.regex);
        if (match) {
          const funcName = match[1];
          const funcId = `${filePath}::${funcName}`;
          functions.push({
            id: funcId,
            label: `${funcName}()`,
            type: pattern.type,
            path: filePath,
            language,
            summary: '',
            code: lines.slice(idx, Math.min(idx + 30, lines.length)).join('\n'),
            score: null,
            grade: 'pending',
            contentHash: computeContentHash(line),
            cyclomaticComplexity: null,
            children: [],
            lastUpdated: new Date().toISOString(),
          });
        }
      }
    }
  });

  return functions;
}

// ─── Parse line-based imports for non-JS/TS files ───────────────────────────
function extractImportsLineBased(content, filePath) {
  const imports = [];
  const lines = content.split('\n');
  const language = detectLanguage(filePath);

  for (const line of lines) {
    // Python: import X / from X import Y
    if (language === 'python') {
      const m1 = line.match(/^\s*import\s+([\w.]+)/);
      const m2 = line.match(/^\s*from\s+([\w.]+)\s+import/);
      if (m1) imports.push(m1[1]);
      if (m2) imports.push(m2[1]);
    }
    // Go: import "pkg"
    if (language === 'go') {
      const m = line.match(/^\s*import\s+"([^"]+)"/);
      if (m) imports.push(m[1]);
    }
  }
  return imports;
}

// ─── Main: parseFileToNodes ─────────────────────────────────────────────────
function parseFileToNodes(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.log(`[CARTOGRAPHER] ⚠ Cannot read file: ${filePath} (${err.message})`);
    return { nodes: [], edges: [] };
  }

  // Relative path from output dir
  const relativePath = path.relative(OUTPUT_DIR, filePath);
  const language = detectLanguage(filePath);
  const contentHash = computeContentHash(content);

  // Create file-level node
  const fileNode = {
    id: relativePath,
    label: path.basename(filePath),
    type: 'file',
    path: relativePath,
    language,
    summary: '',
    code: content.slice(0, 2000),
    score: null,
    grade: 'pending',
    contentHash,
    cyclomaticComplexity: null,
    children: [],
    lastUpdated: new Date().toISOString(),
  };

  // Create directory node
  const dirPath = path.dirname(relativePath);
  const dirNode = dirPath && dirPath !== '.' ? {
    id: dirPath + '/',
    label: dirPath + '/',
    type: 'directory',
    path: dirPath + '/',
    language: 'directory',
    summary: '',
    code: '',
    score: null,
    grade: 'pending',
    contentHash: '',
    cyclomaticComplexity: null,
    children: [relativePath],
    lastUpdated: new Date().toISOString(),
  } : null;

  let functionNodes = [];
  let imports = [];

  // Parse with Babel for JS/TS, fallback for others
  if (isBabelParseable(filePath) && babelParser) {
    try {
      const ast = babelParser.parse(content, {
        sourceType: 'module',
        plugins: [
          'typescript', 'jsx', 'decorators-legacy',
          'classProperties', 'optionalChaining', 'nullishCoalescingOperator',
          'dynamicImport', 'exportDefaultFrom',
        ],
        errorRecovery: true,
      });

      // Compute cyclomatic complexity
      fileNode.cyclomaticComplexity = computeCyclomaticComplexity(ast);

      // Extract functions
      functionNodes = extractFunctionsFromAST(ast, relativePath, content);

      // Extract imports for edge building
      imports = extractImports(ast, relativePath);
    } catch (err) {
      console.log(`[CARTOGRAPHER] ⚠ Babel parse error for ${relativePath}: ${err.message}`);
      // Fall back to line-based
      functionNodes = parseFileLineBased(relativePath, content);
      imports = extractImportsLineBased(content, relativePath);
    }
  } else {
    // Line-based fallback parser
    functionNodes = parseFileLineBased(relativePath, content);
    imports = extractImportsLineBased(content, relativePath);

    // Simple cyclomatic complexity for non-JS files
    const branchKeywords = content.match(/\b(if|else|elif|for|while|switch|case|catch|except|when)\b/g);
    fileNode.cyclomaticComplexity = (branchKeywords ? branchKeywords.length : 0) + 1;
  }

  // Assign function children to file node
  fileNode.children = functionNodes.map(fn => fn.id);

  // Build edges from imports
  const edges = [];
  for (const imp of imports) {
    // Resolve relative imports to file IDs
    let targetId = imp;
    if (imp.startsWith('.')) {
      targetId = path.normalize(path.join(path.dirname(relativePath), imp));
      // Try common extensions
      const exts = ['', '.js', '.ts', '.jsx', '.tsx', '/index.js', '/index.ts'];
      for (const ext of exts) {
        const candidate = targetId + ext;
        // We'll create the edge regardless — Broadcaster handles missing targets
        targetId = candidate;
        break;
      }
    }
    edges.push({
      source: relativePath,
      target: targetId,
    });
  }

  const nodes = [fileNode, ...functionNodes];
  if (dirNode) nodes.unshift(dirNode);

  return { nodes, edges };
}

// ─── Build directory structure for compound graph ──────────────────────────
function buildDirectoryStructure(state) {
  const nodeMap = new Map(state.nodes.map(n => [n.id, n]));

  function walk(dirPath, parentId = null) {
    const parentName = path.basename(dirPath);
    const dirId = dirPath === OUTPUT_DIR ? 'root' : path.relative(OUTPUT_DIR, dirPath);

    // Create directory node if not exists
    if (!nodeMap.has(dirId)) {
      nodeMap.set(dirId, {
        id: dirId,
        label: parentName || 'root',
        type: 'directory',
        parent: parentId,
        grade: 'pending',
        score: null,
      });
    }

    try {
      if (!fs.existsSync(dirPath)) return;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relPath = path.relative(OUTPUT_DIR, fullPath);

        if (entry.isDirectory()) {
          walk(fullPath, dirId);
        } else {
          // Update file node's parent
          const fileNode = nodeMap.get(relPath);
          if (fileNode) {
            fileNode.parent = dirId;
          }
        }
      }
    } catch (e) {}
  }

  walk(OUTPUT_DIR, null);
  state.nodes = Array.from(nodeMap.values());
}

// ─── Atomic write to map-state.json (tmp + rename) ─────────────────────────
function updateMapState(newNodes, newEdges) {
  try {
    const state = readJsonSafe(MAP_STATE_PATH, { nodes: [], edges: [] });

    // Merge nodes: update existing, add new
    const nodeMap = new Map(state.nodes.map(n => [n.id, n]));
    for (const node of newNodes) {
      const existing = nodeMap.get(node.id);
      if (existing && existing.contentHash === node.contentHash) {
        // Content hasn't changed - preserve grades/scores from Sentinel
        node.grade = existing.grade;
        node.score = existing.score;
        node.scoring_breakdown = existing.scoring_breakdown;
      }
      nodeMap.set(node.id, node);
    }
    state.nodes = Array.from(nodeMap.values());

    // Build/Update Directory Structure (Task: Parent Nodes)
    buildDirectoryStructure(state);

    // Sort nodes so directories appear first (helps Cytoscape with parent links)
    state.nodes.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return 0;
    });

    // --- Task: Augment nodes with PageIndex Metadata ---
    const PAGEINDEX_TREE_PATH = path.join(SHARED_DIR, 'pageindex-tree.json');
    if (fs.existsSync(PAGEINDEX_TREE_PATH)) {
      try {
        const treeData = JSON.parse(fs.readFileSync(PAGEINDEX_TREE_PATH, 'utf8'));
        const piNodes = treeData.nodes || [];
        // Map PageIndex nodes by title for faster lookup
        const piMap = new Map();
        for (const pi of piNodes) {
          if (pi.title) piMap.set(pi.title.toLowerCase(), pi);
        }

        let matchCount = 0;
        for (const node of state.nodes) {
          const match = piMap.get(node.label.toLowerCase());
          if (match) {
            node.pageindex_summary = match.summary;
            node.pageindex_node_id = match.node_id;
            matchCount++;
          }
        }
        if (matchCount > 0) {
          console.log(`[CARTOGRAPHER] 🧠 Augmented ${matchCount} nodes with PageIndex metadata`);
        }
      } catch (err) {
        console.error(`[CARTOGRAPHER] ⚠ Failed to augment with PageIndex: ${err.message}`);
      }
    }

    // Merge edges: resolve import targets to actual node IDs
    // e.g. "./routes" → "routes.ts", "./auth" → "auth.ts"
    const nodeIds = new Set(state.nodes.map(n => n.id));
    const edgeSet = new Set(state.edges.map(e => `${e.source}→${e.target}`));
    for (const edge of newEdges) {
      // Try to resolve target to an existing node ID
      let target = edge.target;
      if (!nodeIds.has(target)) {
        // Try adding common extensions
        const candidates = [target + '.ts', target + '.js', target + '.tsx', target + '.jsx'];
        for (const c of candidates) {
          if (nodeIds.has(c)) { target = c; break; }
        }
      }
      edge.target = target;
      const key = `${edge.source}→${edge.target}`;
      if (!edgeSet.has(key) && nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
        state.edges.push(edge);
        edgeSet.add(key);
      }
    }

    // Atomic write
    atomicWriteJson(MAP_STATE_PATH, state);

    console.log(`[CARTOGRAPHER] ✔ Updated map-state.json (${state.nodes.length} nodes, ${state.edges.length} edges)`);
  } catch (err) {
    console.error(`[CARTOGRAPHER] ✖ Failed to update map-state.json: ${err.message}`);
  }
}

// ─── Shared Path Watcher (for hot-swapping project folders) ─────────────────
const pathMarker = path.join(SHARED_DIR, 'active-watch-path.txt');
let currentWatcher = createWatcher(OUTPUT_DIR);

function createWatcher(dir) {
  console.log(`[CARTOGRAPHER] Watching ${dir} for file changes...`);
  const w = chokidar.watch(dir, {
    ignoreInitial: false,
    ignored: [/(^|[\/\\])\../, /node_modules/, /\.tmp$/],
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  w.on('all', (event, filePath) => {
    if (!['add', 'change'].includes(event)) return;
    try { if (fs.statSync(filePath).isDirectory()) return; } catch (e) { return; }

    console.log(`[CARTOGRAPHER] 📁 File ${event}: ${path.relative(dir, filePath)}`);
    pendingFiles.add(filePath);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const files = Array.from(pendingFiles);
      pendingFiles.clear();
      let allNodes = [];
      let allEdges = [];
      for (const file of files) {
        const result = parseFileToNodes(file);
        allNodes.push(...result.nodes);
        allEdges.push(...result.edges);
      }
      if (allNodes.length > 0) updateMapState(allNodes, allEdges);
    }, 300);
  });

  w.on('error', (err) => console.error(`[CARTOGRAPHER] ✖ Watcher error: ${err.message}`));
  return w;
}

// Watch the path-marker for live project switching
chokidar.watch(pathMarker).on('change', () => {
  try {
    const newPath = fs.readFileSync(pathMarker, 'utf8').trim();
    if (newPath && fs.existsSync(newPath)) {
      console.log(`[CARTOGRAPHER] 🔄 Switching watch target to: ${newPath}`);
      if (currentWatcher) currentWatcher.close();
      
      // Reset map state for new project
      atomicWriteJson(MAP_STATE_PATH, { nodes: [], edges: [] });
      
      currentWatcher = createWatcher(newPath);
    }
  } catch (e) {
    console.error(`[CARTOGRAPHER] ✖ Path swap failed: ${e.message}`);
  }
});

console.log('[CARTOGRAPHER] Agent started successfully');
