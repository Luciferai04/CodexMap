const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function generatePDF() {
  const writeupPath = path.join(__dirname, '..', 'PRODUCT_WRITEUP.md');
  const outputPath = path.join(__dirname, '..', 'CodexMap_Whitepaper.pdf');

  if (!fs.existsSync(writeupPath)) {
    console.error('PRODUCT_WRITEUP.md not found!');
    process.exit(1);
  }

  const markdownContent = fs.readFileSync(writeupPath, 'utf8');

  console.log('[PDF] Launching browser...');
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();

  // Create HTML wrapper with GitHub-like styling and Coinbase aesthetics
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>CodexMap Whitepaper</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown.min.css">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
      <style>
        body {
          background-color: #ffffff;
          padding: 40px;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        }
        .markdown-body {
          box-sizing: border-box;
          min-width: 200px;
          max-width: 980px;
          margin: 0 auto;
          padding: 45px;
          border: 1px solid #eef0f3;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        h1, h2, h3 { color: #0052ff !important; border-bottom: none !important; }
        blockquote { border-left: 0.25em solid #0052ff !important; color: #5b616e !important; }
        .mermaid { margin: 20px 0; display: flex; justify-content: center; }
        @media print {
          .markdown-body { border: none; box-shadow: none; padding: 0; }
          body { padding: 0; }
        }
      </style>
    </head>
    <body class="markdown-body">
      <div id="content"></div>
      <script>
        // Configure marked
        marked.setOptions({
          gfm: true,
          breaks: true
        });

        // Configure mermaid
        mermaid.initialize({ startOnLoad: false, theme: 'default' });

        const rawMd = \`${markdownContent.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
        
        // Render Markdown
        document.getElementById('content').innerHTML = marked.parse(rawMd);

        // Render Mermaid diagrams
        async function renderMermaid() {
          const diagrams = document.querySelectorAll('code.language-mermaid');
          for (const diag of diagrams) {
            const container = document.createElement('div');
            container.className = 'mermaid';
            container.textContent = diag.textContent;
            diag.parentElement.replaceWith(container);
          }
          await mermaid.run();
        }

        renderMermaid().then(() => {
          // Signal completion to Puppeteer
          window.mermaidDone = true;
        });
      </script>
    </body>
    </html>
  `;

  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  console.log('[PDF] Waiting for Mermaid to render...');
  await page.waitForFunction('window.mermaidDone === true', { timeout: 30000 });
  
  // Extra wait for fonts and assets
  await new Promise(r => setTimeout(r, 2000));

  console.log('[PDF] Taking preview screenshot...');
  const previewPath = path.join(__dirname, '..', 'CodexMap_Whitepaper_Preview.png');
  await page.screenshot({
    path: previewPath,
    fullPage: true
  });
  console.log(`[PDF] Preview saved to: ${previewPath}`);

  console.log('[PDF] Exporting to PDF...');
  await page.pdf({
    path: outputPath,
    format: 'A4',
    margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size: 10px; width: 100%; text-align: right; margin-right: 20px;"><span class="title"></span></div>',
    footerTemplate: '<div style="font-size: 10px; width: 100%; text-align: center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });

  await browser.close();
  console.log(`[PDF] Success! Whitepaper saved to: ${outputPath}`);
}

generatePDF().catch(err => {
  console.error('[PDF] Error generating PDF:', err);
  process.exit(1);
});
