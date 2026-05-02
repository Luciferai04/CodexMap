const fs = require('fs');

let graphJs = fs.readFileSync('ui/graph.js', 'utf8');

// 1. Add renderer: { name: 'gl' }
if (!graphJs.includes("renderer: { name: 'gl' }")) {
  graphJs = graphJs.replace(
    "container: container,",
    "container: container,\n      renderer: { name: 'gl' },  // WebGL Renderer Fallback"
  );
}

// 2. Add block node style
const blockStyle = `
    {
      selector: 'node[type="block"]',
      style: {
        'shape': 'hexagon',
        'background-color': '#f8f9fa',
        'border-color': '#adb5bd',
        'border-style': 'dashed',
        'border-width': '1px',
        'font-family': 'IBM Plex Mono, monospace',
        'font-size': '10px',
        'padding': '5px',
        'height': '20px'
      }
    },
`;

if (!graphJs.includes('node[type="block"]')) {
  graphJs = graphJs.replace(
    "selector: 'node.dimmed',",
    blockStyle + "\n    {\n      selector: 'node.dimmed',"
  );
}

// 3. Add double-click zoom logic for blocks
if (!graphJs.includes("dblclick', 'node[type=\"block\"]'")) {
  graphJs = graphJs.replace(
    "cy.on('tap', 'node:childless', (evt) => {",
    "cy.on('dblclick', 'node[type=\"block\"]', (evt) => {\n      cy.animate({ fit: { eles: evt.target, padding: 50 } }, { duration: 300 });\n    });\n\n    cy.on('tap', 'node:childless', (evt) => {"
  );
}

fs.writeFileSync('ui/graph.js', graphJs, 'utf8');
console.log('Graph fixes applied');
