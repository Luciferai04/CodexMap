const fs = require('fs');

let html = fs.readFileSync('ui/index.html', 'utf8');

const cspMeta = `<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.cdnfonts.com https://fonts.googleapis.com https://unpkg.com; 
               style-src 'self' 'unsafe-inline' https://fonts.cdnfonts.com https://fonts.googleapis.com; 
               font-src 'self' https://fonts.cdnfonts.com https://fonts.gstatic.com; 
               connect-src ws://localhost:4242 http://localhost:3000 http://localhost:4242 https://api.openai.com; 
               img-src 'self' data:;">`;

if (!html.includes('Content-Security-Policy')) {
  html = html.replace('<title>', cspMeta + '\n  <title>');
  fs.writeFileSync('ui/index.html', html, 'utf8');
  console.log('CSP Meta injected into ui/index.html');
} else {
  console.log('CSP already exists');
}
