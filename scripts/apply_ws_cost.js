const fs = require('fs');
let wsJs = fs.readFileSync('ui/ws.js', 'utf8');

const wsCostHandler = `
  if (data.type === 'cost_update') {
    document.getElementById('api-tokens').innerText = data.payload.total_tokens || 0;
    document.getElementById('api-cost').innerText = (data.payload.total_cost_usd || 0).toFixed(4);
  }
`;

if (!wsJs.includes("type === 'cost_update'")) {
  wsJs = wsJs.replace("if (data.type === 'collapse_warning') {", wsCostHandler + "\n  if (data.type === 'collapse_warning') {");
  fs.writeFileSync('ui/ws.js', wsJs, 'utf8');
}
