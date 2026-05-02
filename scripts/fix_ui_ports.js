const fs = require('fs');
let wsJs = fs.readFileSync('ui/ws.js', 'utf8');
wsJs = wsJs.replace(':4242', ':4343').replace(':4242', ':3100');
fs.writeFileSync('ui/ws.js', wsJs, 'utf8');
