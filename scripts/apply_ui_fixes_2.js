const fs = require('fs');

// 1. Add triggerFullReanchor to ws.js
let wsJs = fs.readFileSync('ui/ws.js', 'utf8');
if (!wsJs.includes('triggerFullReanchor')) {
  wsJs += `
window.triggerFullReanchor = function() {
  fetch('http://localhost:4242/reheal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch: true })
  }).then(res => res.json())
    .then(data => console.log('Full sweep triggered:', data))
    .catch(err => console.error('Full sweep failed:', err));
};
`;
  fs.writeFileSync('ui/ws.js', wsJs, 'utf8');
}

// 2. Update panel.js to render AI Summary
let panelJs = fs.readFileSync('ui/panel.js', 'utf8');
if (!panelJs.includes('ai-summary-container')) {
  panelJs = panelJs.replace(
    /document\.getElementById\('node-summary'\)\.textContent\s*=\s*nodeData\.summary\s*\|\|\s*'No summary available';/,
    `document.getElementById('node-summary').textContent = nodeData.summary || 'No summary available';
    
    // Inject AI Summary safely if it exists (Priority 1)
    let aiContainer = document.getElementById('ai-summary-container');
    if (!aiContainer) {
      aiContainer = document.createElement('div');
      aiContainer.id = 'ai-summary-container';
      aiContainer.style.marginTop = '10px';
      aiContainer.style.padding = '8px';
      aiContainer.style.backgroundColor = '#f4f5f9';
      aiContainer.style.borderRadius = '6px';
      aiContainer.style.fontSize = '12px';
      aiContainer.style.color = '#333';
      aiContainer.style.borderLeft = '3px solid #5B76FE';
      const summaryEl = document.getElementById('node-summary');
      summaryEl.parentNode.insertBefore(aiContainer, summaryEl.nextSibling);
    }
    
    if (nodeData.summary && nodeData.summary.length > 5) {
      aiContainer.innerHTML = '<strong>AI Insight:</strong> ' + nodeData.summary;
      aiContainer.style.display = 'block';
    } else {
      aiContainer.style.display = 'none';
    }`
  );
  fs.writeFileSync('ui/panel.js', panelJs, 'utf8');
}

// 3. Update drift-timeline.js to draw annotations
let driftJs = fs.readFileSync('ui/drift-timeline.js', 'utf8');
if (!driftJs.includes('data.annotation')) {
  driftJs = driftJs.replace(
    "ctx.fillStyle = isRed ? '#F24822' : '#5B76FE';",
    `ctx.fillStyle = isRed ? '#F24822' : '#5B76FE';
    
    if (data.annotation) {
      ctx.fillStyle = '#F24822';
      ctx.font = '10px Noto Sans';
      ctx.fillText(data.annotation, x, y - 10);
    }`
  );
  fs.writeFileSync('ui/drift-timeline.js', driftJs, 'utf8');
}

console.log('UI fixes 2 applied');
