
function parseFileToNodes(filePath) {
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`[CARTOGRAPHER] Failed to read ${filePath}: ${err.message}`);
    return [];
  }

  const ext = path.extname(filePath);
  
  if (BABEL_LANGS.includes(ext)) {
    return parseBabel(filePath, content);
  } else if (hasTreeSitter && TREE_SITTER_LANGS[ext]) {
    return parseTreeSitter(filePath, content, TREE_SITTER_LANGS[ext]);
  } else {
    return parseGeneric(filePath, content);
  }
}

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

let Parser, tsJS, tsTS, tsPY, tsGO;
let hasTreeSitter = false;
try {
  Parser = require('tree-sitter');
  tsJS   = require('tree-sitter-javascript');
  tsTS   = require('tree-sitter-typescript').typescript;
  tsPY   = require('tree-sitter-python');
  tsGO   = require('tree-sitter-go');
  hasTreeSitter = true;
} catch (e) {
  console.warn('[CARTOGRAPHER] ⚠ Tree-sitter failed to load. Polyglot AST support limited.');
}

const TREE_SITTER_LANGS = {
  '.py': tsPY,
  '.go': tsGO,
};
const BABEL_LANGS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];


let babelParser, babelTraverse;
try {
  babelParser = require('@babel/parser');
  babelTraverse = require('@babel/traverse').default;
} catch (e) {
  console.error('[CARTOGRAPHER] Babel tools not installed, JS/TS parsing disabled');
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

// ─── Parse imports/edges from AST for edge building ──────────────────────────
function parseFileToEdges(filePath, code) {
  const edges = [];
  const fileId = filePath.replace('./', '');
  
  // Logic-based resolution for imports/requires
  const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)/g;
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    const importPath = match[1] || match[2];
    if (importPath && !importPath.startsWith('.') && !importPath.includes('/')) continue; // Skip built-ins/npm
    
    const resolved = resolveImport(filePath, importPath);
    if (resolved) {
      edges.push({
        source: fileId,
        target: resolved,
        type: 'dependency'
      });
    }
  }
  return edges;
}

function resolveImport(currentFile, importPath) {
  try {
    const base = path.dirname(currentFile);
    // Common extensions for resolution
    const extensions = ['', '.js', '.ts', '.jsx', '.tsx', '/index.js', '/index.ts'];
    
    for (const ext of extensions) {
      const full = path.join(base, importPath + ext).replace(/\\/g, '/');
      const rel = full.replace('./', '');
      // This is a heuristic resolution; in a real environment, we'd check fs.existsSync
      return rel;
    }
  } catch (e) {}
  return null;
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

const BLOCK_VISITORS = {
  TryStatement(path, state) {
    state.blocks.push({
      id: `${state.fileId}::${state.fnName}::try::${path.node.loc?.start.line}`,
      label: `try block`,
      type: 'block',
      blockKind: 'try',
      parent: state.fnId,
      lineStart: path.node.loc?.start.line,
      lineEnd: path.node.handler?.loc?.end.line,
      code: state.code.slice(
        path.node.start, 
        Math.min(path.node.end, path.node.start + 500)
      ),
    });
    if (path.node.handler) {
      state.blocks.push({
        id: `${state.fileId}::${state.fnName}::catch::${path.node.handler.loc?.start.line}`,
        label: `catch (${path.node.handler.param?.name || 'e'})`,
        type: 'block',
        blockKind: 'catch',
        parent: state.fnId,
        lineStart: path.node.handler.loc?.start.line,
        lineEnd: path.node.handler.loc?.end.line,
        code: state.code.slice(path.node.handler.start, 
          Math.min(path.node.handler.end, path.node.handler.start + 400)),
      });
    }
  },
  IfStatement(path, state) {
    if (path.parentPath.isIfStatement()) return;
    state.blocks.push({
      id: `${state.fileId}::${state.fnName}::if::${path.node.loc?.start.line}`,
      label: `if (${extractConditionText(path.node.test, state.code)})`,
      type: 'block',
      blockKind: 'if',
      parent: state.fnId,
      lineStart: path.node.loc?.start.line,
      lineEnd: path.node.loc?.end.line,
      cyclomaticWeight: 1,
    });
  },
  ForStatement:    (path, state) => extractLoopBlock('for',     path, state),
  WhileStatement:  (path, state) => extractLoopBlock('while',   path, state),
  ForOfStatement:  (path, state) => extractLoopBlock('for-of',  path, state),
  ForInStatement:  (path, state) => extractLoopBlock('for-in',  path, state),
  SwitchStatement(path, state) {
    state.blocks.push({
      id: `${state.fileId}::${state.fnName}::switch::${path.node.loc?.start.line}`,
      label: `switch (${extractConditionText(path.node.discriminant, state.code)})`,
      type: 'block',
      blockKind: 'switch',
      parent: state.fnId,
      lineStart: path.node.loc?.start.line,
      lineEnd: path.node.loc?.end.line,
      cyclomaticWeight: path.node.cases.length,
    });
  },
};

function extractLoopBlock(kind, path, state) {
  state.blocks.push({
    id: `${state.fileId}::${state.fnName}::${kind}::${path.node.loc?.start.line}`,
    label: `${kind} loop`,
    type: 'block',
    blockKind: kind,
    parent: state.fnId,
    lineStart: path.node.loc?.start.line,
    lineEnd: path.node.loc?.end.line,
    cyclomaticWeight: 1,
  });
}

function extractConditionText(node, code) {
  try {
    return code.slice(node.start, node.end).slice(0, 40);
  } catch { return '...'; }
}

function computeCC(funcPath) {
  let cc = 1;
  funcPath.traverse({
    IfStatement:        () => cc++,
    ConditionalExpression: () => cc++,
    LogicalExpression:  ({ node }) => { if (node.operator === '&&' || node.operator === '||') cc++; },
    ForStatement:       () => cc++,
    ForInStatement:     () => cc++,
    ForOfStatement:     () => cc++,
    WhileStatement:     () => cc++,
    DoWhileStatement:   () => cc++,
    SwitchCase:         ({ node }) => { if (node.test) cc++; },
    CatchClause:        () => cc++,
  });
  return cc;
}

function parseBabel(filePath, initialContent) {
  let content = initialContent;
  if (!content) {
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.log(`[CARTOGRAPHER] ⚠ Cannot read file: ${filePath} (${err.message})`);
      return { nodes: [], edges: [] };
    }
  }

  // Relative path from output dir
  const relativePath = path.relative(OUTPUT_DIR, filePath);
  const language = detectLanguage(filePath);
  const contentHash = computeContentHash(content);

  const dirPath = path.dirname(relativePath);
  const dirId = dirPath === '.' ? 'root' : dirPath;

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
    drift_signals: [],
    pageindex_summary: '',
    contentHash,
    cyclomaticComplexity: null,
    children: [],
    lastUpdated: new Date().toISOString(),
    parent: dirId
  };

  // Create directory node
  const dirNode = dirPath && dirPath !== '.' ? {
    id: dirId,
    label: dirPath,
    type: 'directory',
    path: dirPath,
    language: 'directory',
    summary: '',
    code: '',
    score: null,
    grade: 'pending',
    drift_signals: [],
    pageindex_summary: '',
    contentHash: '',
    cyclomaticComplexity: null,
    children: [relativePath],
    lastUpdated: new Date().toISOString(),
  } : null;

  let functionNodes = [];
  let edges = [];

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

      // Extract Level 4 Block Nodes
      const blocks = [];
      babelTraverse(ast, {
        "TryStatement|IfStatement|ForStatement|WhileStatement|SwitchStatement"(path) {
          const fnParent = path.getFunctionParent();
          if (!fnParent) return;
          
          let fnName = 'anonymous';
          if (fnParent.node.id) fnName = fnParent.node.id.name;
          else if (fnParent.parentPath && fnParent.parentPath.type === 'VariableDeclarator' && fnParent.parentPath.node.id) {
            fnName = fnParent.parentPath.node.id.name;
          }
          
          const fnId = `${relativePath}::${fnName}`;
          const kind = path.node.type.replace('Statement', '').toLowerCase();
          const blockId = `${fnId}::${kind}::${path.node.loc?.start.line}`;
          
          blocks.push({
            id: blockId,
            label: `${kind} block`,
            type: 'block',
            blockKind: kind,
            parent: fnId,
            path: relativePath,
            lineStart: path.node.loc?.start.line,
            lineEnd: path.node.loc?.end.line,
            code: content.slice(path.node.start, Math.min(path.node.end, path.node.start + 500)),
            grade: 'pending',
            score: null
          });
        }
      });
      
      // Compute CC for each function
      functionNodes.forEach(fn => {
        const fName = fn.label.replace('()', '');
        babelTraverse(ast, {
          enter(path) {
            if (path.isFunction() && (path.node.id?.name === fName || path.parent.id?.name === fName)) {
               fn.cyclomaticComplexity = computeCC(path);
               path.stop();
            }
          }
        });
      });

      functionNodes.push(...blocks);

      // Extract logic-based edges
      edges = parseFileToEdges(filePath, content);
    } catch (err) {
      console.log(`[CARTOGRAPHER] ⚠ Babel parse error for ${relativePath}: ${err.message}`);
      // Fall back to line-based
      functionNodes = parseFileLineBased(relativePath, content);
      edges = parseFileToEdges(filePath, content);
    }
  } else {
    // Line-based fallback parser
    functionNodes = parseFileLineBased(relativePath, content);
    const imps = extractImportsLineBased(content, relativePath);
    edges = imps.map(target => ({ source: relativePath, target }));

    // Simple cyclomatic complexity for non-JS files
    const branchKeywords = content.match(/\b(if|else|elif|for|while|switch|case|catch|except|when)\b/g);
    fileNode.cyclomaticComplexity = (branchKeywords ? branchKeywords.length : 0) + 1;
  }

  // Assign function children to file node
  fileNode.children = functionNodes.map(fn => fn.id);

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
        path: dirId,
        grade: 'pending',
        score: null,
        drift_signals: [],
        pageindex_summary: ''
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
    const nodeIds = new Set(state.nodes.map(n => n.id));
    const edgeMap = new Map();
    // Load existing edges first to avoid duplicates
    (state.edges || []).forEach(e => edgeMap.set(`${e.source}→${e.target}`, e));

    for (const edge of newEdges) {
      let target = edge.target;
      // 1. Resolve relative paths
      if (target.startsWith('.')) {
        target = path.normalize(path.join(path.dirname(edge.source), target));
      }

      // 2. Resolve to existing node ID with common extensions
      if (!nodeIds.has(target)) {
        const candidates = [
          target, 
          target + '.ts', target + '.js', target + '.tsx', target + '.jsx',
          path.join(target, 'index.ts'), path.join(target, 'index.js')
        ];
        for (const c of candidates) {
          if (nodeIds.has(c)) { target = c; break; }
        }
      }

      // 3. Only add if both sides exist and it's not a duplicate
      if (nodeIds.has(edge.source) && nodeIds.has(target)) {
        const key = `${edge.source}→${target}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { 
            id: key, 
            source: edge.source, 
            target: target,
            type: 'import',
            crossContamination: false
          });
        }
      }
    }
    state.edges = Array.from(edgeMap.values());

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

    const relPath = path.relative(dir, filePath);
    const size = fs.statSync(filePath).size;
    console.log(`[CARTOGRAPHER] 📁 File ${event}: ${relPath} (${size} bytes)`);
    
    // Skip empty files (0 bytes) — they're likely stubs or in-progress writes
    if (size === 0) {
      console.log(`[CARTOGRAPHER] ⏭ Skipping empty file: ${relPath}`);
      return;
    }
    
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



function parseTreeSitter(filePath, code, Language) {
  const parser = new Parser();
  parser.setLanguage(Language);
  const tree = parser.parse(code);
  const nodes = [];
  const fileId = filePath.replace('./', '');

  nodes.push({
    id: fileId,
    label: path.basename(filePath),
    type: 'file',
    path: filePath,
    lineCount: code.split('\n').length,
    code: code.slice(0, 500),
    grade: 'pending',
    score: null,
    language: path.extname(filePath).slice(1),
  });

  function walk(node, parentId) {
    const FUNCTION_TYPES = [
      'function_definition',
      'function_declaration',
      'method_definition',
      'func_literal',
    ];
    if (FUNCTION_TYPES.includes(node.type)) {
      const nameNode = node.childForFieldName?.('name') || 
                       node.children?.find(c => c.type === 'identifier');
      const name = nameNode ? code.slice(nameNode.startIndex, nameNode.endIndex) : 'anonymous';
      const nodeId = `${fileId}::${name}::${node.startPosition.row}`;
      const funcCode = code.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 2000));

      nodes.push({
        id: nodeId,
        label: name,
        type: 'function',
        parent: parentId,
        path: filePath,
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1,
        lineCount: node.endPosition.row - node.startPosition.row + 1,
        code: funcCode,
        grade: 'pending',
        score: null,
        language: path.extname(filePath).slice(1),
        cyclomaticComplexity: 1 // fallback for non-JS
      });

      node.children?.forEach(child => walk(child, nodeId));
    } else {
      node.children?.forEach(child => walk(child, parentId));
    }
  }
  walk(tree.rootNode, fileId);
  return { nodes, edges: [] };
}

function parseGeneric(filePath, code) {
  return { nodes: [{
    id: filePath.replace('./', ''),
    label: path.basename(filePath),
    type: 'file',
    path: filePath,
    lineCount: code.split('\n').length,
    code: code.slice(0, 300),
    grade: 'pending',
    score: null,
    language: path.extname(filePath).slice(1) || 'unknown',
    cyclomaticComplexity: 1
  }], edges: [] };
}
