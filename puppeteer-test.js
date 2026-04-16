const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
  
  await page.goto('file:///Users/soumyajitghosh/Documents/codexAxiom/Code%20Generation%20Map/codexmap/ui/index.html?project=Test');
  
  await new Promise(r => setTimeout(r, 5000));
  
  const status = await page.$eval('#status-text', el => el.textContent);
  console.log('STATUS TEXT:', status);
  
  const loading = await page.$eval('#loading-overlay', el => el.className);
  console.log('LOADING OVERLAY CLASS:', loading);

  await browser.close();
})();
