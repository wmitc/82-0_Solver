const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true, args:['--no-sandbox'] });
  const pg = await b.newPage();
  pg.on('console', m => { const t=m.text(); if(t.includes('[v0]')||t.includes('combination')||t.includes('result')) console.log('LOG>', t); });
  await pg.goto('https://www.82-0.com', { waitUntil:'networkidle', timeout:60000 });
  await pg.waitForTimeout(2000);
  const click = async (name) => { try{ await pg.getByRole('button',{name}).first().click({timeout:5000}); console.log('clicked',name);}catch(e){console.log('no btn',name);} };
  await click('Accept');
  await click('Play Classic');
  await pg.waitForTimeout(4000);
  // dump state
  const dump = async (tag) => {
    const d = await pg.evaluate(() => {
      const txt = el => (el.innerText||'').trim().replace(/\s+/g,' ');
      return {
        buttons:[...document.querySelectorAll('button')].map(b=>txt(b)).filter(Boolean).slice(0,40),
        body:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,900)
      };
    });
    console.log(`\n===== ${tag} =====`);
    console.log('BUTTONS:', JSON.stringify(d.buttons));
    console.log('BODY:', d.body);
  };
  await dump('after Play Classic');
  await pg.screenshot({ path:'shot_draft.png' });
  await b.close();
})().catch(e=>{console.error('ERR',e);process.exit(1)});
