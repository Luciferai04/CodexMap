const fs = require('fs');

let content = fs.readFileSync('agents/cartographer.js', 'utf8');

// 1. Add Tree-sitter imports at the top
const tsImports = `
const Parser = require('tree-sitter');
const tsJS   = require('tree-sitter-javascript');
const tsTS   = require('tree-sitter-typescript').typescript;
const tsPY   = require('tree-sitter-python');
const tsGO   = require('tree-sitter-go');

const TREE_SITTER_LANGS = {
  '.py': tsPY,
  '.go': tsGO,
};
const BABEL_LANGS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
`;

if (!content.includes("require('tree-sitter')")) {
  content = content.replace("const crypto = require('crypto');", "const crypto = require('crypto');\n" + tsImports);
}

// 2. BLOCK_VISITORS and CC extraction
const blockVisitors = `
const BLOCK_VISITORS = {
  TryStatement(path, state) {
    state.blocks.push({
      id: \`\${state.fileId}::\${state.fnName}::try::\${path.node.loc?.start.line}\`,
      label: \`try block\`,
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
        id: \`\${state.fileId}::\${state.fnName}::catch::\${path.node.handler.loc?.start.line}\`,
        label: \`catch (\${path.node.handler.param?.name || 'e'})\`,
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
      id: \`\${state.fileId}::\${state.fnName}::if::\${path.node.loc?.start.line}\`,
      label: \`if (\${extractConditionText(path.node.test, state.code)})\`,
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
      id: \`\${state.fileId}::\${state.fnName}::switch::\${path.node.loc?.start.line}\`,
      label: \`switch (\${extractConditionText(path.node.discriminant, state.code)})\`,
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
    id: \`\${state.fileId}::\${state.fnName}::\${kind}::\${path.node.loc?.start.line}\`,
    label: \`\${kind} loop\`,
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
`;

if (!content.includes('const BLOCK_VISITORS')) {
  content = content.replace("function parseFileToNodes(filePath) {", blockVisitors + "\nfunction parseFileToNodes(filePath) {");
}

// 3. Update parseFileToNodes to route to parseTreeSitter / parseBabel / parseGeneric
// The existing function has a specific logic. We will replace its core.
// The easiest way is to inject parseTreeSitter and parseGeneric, and modify parseFileToNodes.
const treeSitterCode = `
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
    lineCount: code.split('\\n').length,
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
      const nodeId = \`\${fileId}::\${name}::\${node.startPosition.row}\`;
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
    lineCount: code.split('\\n').length,
    code: code.slice(0, 300),
    grade: 'pending',
    score: null,
    language: path.extname(filePath).slice(1) || 'unknown',
    cyclomaticComplexity: 1
  }], edges: [] };
}
`;

if (!content.includes('function parseTreeSitter(')) {
  content = content + "\n\n" + treeSitterCode;
}

fs.writeFileSync('agents/cartographer.js', content, 'utf8');
console.log('Cartographer stage 1 applied.');
