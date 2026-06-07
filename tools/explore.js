const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true, args:['--no-sandbox'] });
  const pg = await b.newPage();
  pg.on('console', m => console.log('CONSOLE>', m.text()));
  await pg.goto('https://www.82-0.com', { waitUntil:'networkidle', timeout:60000 });
  await pg.waitForTimeout(3000);
  // dump visible buttons and headings
  const info = await pg.evaluate(() => {
    const txt = el => (el.innerText||'').trim().replace(/\s+/g,' ').slice(0,60);
    const btns = [...document.querySelectorAll('button')].map(b=>txt(b)).filter(Boolean);
    const h = [...document.querySelectorAll('h1,h2,h3')].map(txt).filter(Boolean);
    return { title:document.title, url:location.href, headings:h, buttons:btns,
             bodyStart:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,500) };
  });
  console.log('INFO>', JSON.stringify(info, null, 2));
  await pg.screenshot({ path:'shot_landing.png' });
  await b.close();
})().catch(e=>{console.error('ERR',e);process.exit(1)});
