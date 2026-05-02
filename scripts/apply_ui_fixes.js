const fs = require('fs');
let html = fs.readFileSync('ui/index.html', 'utf8');

// Add Cytoscape-gl script
if (!html.includes('cytoscape-gl')) {
  html = html.replace(
    '<script src="https://unpkg.com/cytoscape-cose-bilkent@4.1.0/cytoscape-cose-bilkent.js"></script>',
    '<script src="https://unpkg.com/cytoscape-cose-bilkent@4.1.0/cytoscape-cose-bilkent.js"></script>\n  <script src="https://unpkg.com/cytoscape-gl"></script>'
  );
}

// Add Full Re-anchor Sweep button to collapse banner
if (!html.includes('triggerFullReanchor()')) {
  html = html.replace(
    '<button class="banner-close" onclick="document.getElementById(\'collapse-banner\').hidden = true">✕</button>',
    '<button class="banner-close" onclick="document.getElementById(\'collapse-banner\').hidden = true">✕</button>\n        <button class="btn-primary" onclick="triggerFullReanchor()">Full Re-anchor Sweep</button>'
  );
}

fs.writeFileSync('ui/index.html', html, 'utf8');

let wsJs = fs.readFileSync('ui/ws.js', 'utf8');
if (!wsJs.includes('__collapse_warning')) {
  // We need to handle the collapse warning event
  wsJs = wsJs.replace(
    "if (data.type === 'node_grade') {",
    "if (data.type === '__collapse_warning') {\n      const banner = document.getElementById('collapse-banner');\n      if (data.triggered) {\n        banner.hidden = false;\n        document.getElementById('collapse-banner-text').textContent = '⚠ Architectural Collapse Detected — ' + data.signals.join(', ');\n      } else {\n        banner.hidden = true;\n      }\n      return;\n    }\n    if (data.type === 'node_grade') {"
  );
}
fs.writeFileSync('ui/ws.js', wsJs, 'utf8');
console.log('UI fixes applied');
