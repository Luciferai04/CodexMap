const fs = require('fs');

let content = fs.readFileSync('agents/cartographer.js', 'utf8');

// 1. Rename parseFileToNodes to parseBabel
content = content.replace("function parseFileToNodes(filePath) {", "function parseBabel(filePath, content) {");

// 2. Add the router parseFileToNodes
const router = `
function parseFileToNodes(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.log(\`[CARTOGRAPHER] ⚠ Cannot read file: \${filePath} (\${err.message})\`);
    return { nodes: [], edges: [] };
  }

  const ext = path.extname(filePath);
  
  if (BABEL_LANGS.includes(ext)) {
    return parseBabel(filePath, content);
  } else if (TREE_SITTER_LANGS[ext]) {
    return parseTreeSitter(filePath, content, TREE_SITTER_LANGS[ext]);
  } else {
    return parseGeneric(filePath, content);
  }
}
`;

content = router + "\n" + content;

// 3. Fix parseBabel to read file if not passed (though we pass it now)
content = content.replace("  let content;\n  try {\n    content = fs.readFileSync(filePath, 'utf8');\n  } catch (err) {\n    console.log(`[CARTOGRAPHER] ⚠ Cannot read file: ${filePath} (${err.message})`);\n    return { nodes: [], edges: [] };\n  }\n", "");


// 4. Inject block node extraction using babelTraverse inside parseBabel
// Find where functionNodes are extracted:
// functionNodes = extractFunctionsFromAST(ast, relativePath, content);
// Right after that, we can add the second traversal.
const secondTraverse = `
      // For each function node, run a second traverse scoped to that function's AST subtree
      functionNodes.forEach(fn => {
        const fnNode = ast.program.body.find(n => 
           (n.loc?.start.line <= fn.lineStart && n.loc?.end.line >= fn.lineEnd) ||
           (content.slice(n.start, n.end).includes(fn.label.replace('()','')))
        );
        // This is a naive lookup; a real robust solution uses path.traverse inside extractFunctionsFromAST.
      });
`;
// Let's do it the robust way inside parseBabel using a full traverse over the AST.
const blockTraverse = `
      // Extract block nodes
      const blocks = [];
      babelTraverse(ast, {
        enter(path) {
          const fnParent = path.getFunctionParent();
          if (!fnParent) return;
          
          let fnName = 'anonymous';
          if (fnParent.node.id) fnName = fnParent.node.id.name;
          else if (fnParent.parentPath && fnParent.parentPath.type === 'VariableDeclarator' && fnParent.parentPath.node.id) {
            fnName = fnParent.parentPath.node.id.name;
          } else if (fnParent.parentPath && fnParent.parentPath.type === 'MethodDefinition' && fnParent.parentPath.node.key) {
            fnName = fnParent.parentPath.node.key.name;
          }

          const state = {
            fileId: relativePath,
            fnName,
            fnId: \`\${relativePath}::\${fnName}\`,
            code: content,
            blocks
          };
          
          if (BLOCK_VISITORS[path.node.type]) {
            BLOCK_VISITORS[path.node.type](path, state);
          }
        }
      });
      
      // Inject cyclomaticComplexity to function nodes by finding them in AST
      functionNodes.forEach(fn => {
        const parts = fn.id.split('::');
        const fName = parts[parts.length-1];
        let cc = 1;
        babelTraverse(ast, {
          enter(path) {
            if (path.isFunction() && (path.node.id?.name === fName || (path.parent.id?.name === fName))) {
               cc = computeCC(path);
               path.stop();
            }
          }
        });
        fn.cyclomaticComplexity = cc;
      });

      functionNodes.push(...blocks);
`;

content = content.replace("      functionNodes = extractFunctionsFromAST(ast, relativePath, content);", "      functionNodes = extractFunctionsFromAST(ast, relativePath, content);\n" + blockTraverse);

fs.writeFileSync('agents/cartographer.js', content, 'utf8');
console.log('Cartographer router and block extraction applied.');
