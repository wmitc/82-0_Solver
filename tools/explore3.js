const { chromium } = require('playwright-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async () => {
  const b = await chromium.launch({ executablePath:'/usr/bin/chromium', headless:true, args:['--no-sandbox'] });
  const pg = await b.newPage();
  pg.on('console', m=>{const t=m.text(); if(t.includes('[v0]')) console.log('LOG>',t);});
  await pg.goto('https://www.82-0.com',{waitUntil:'networkidle',timeout:60000});
  await sleep(2000);
  // click any button whose text matches, in-page (bypasses overlay issues)
  const clickText = (labels) => pg.evaluate((labels)=>{
    const norm=s=>(s||'').trim().toLowerCase();
    const btns=[...document.querySelectorAll('button')];
    for(const lab of labels){
      const el=btns.find(b=>norm(b.innerText)===norm(lab));
      if(el){el.click();return lab;}
    }
    return null;
  }, labels);
  console.log('click1',await clickText(['Accept']));
  await sleep(500);
  console.log('close instr',await clickText(["Don't Show Again","Close"]));
  await sleep(500);
  console.log('mode',await clickText(['Play Classic']));
  await sleep(3500);
  console.log('close instr2',await clickText(["Don't Show Again","Close"]));
  await sleep(2000);
  const d = await pg.evaluate(()=>{
    const txt=el=>(el.innerText||'').trim().replace(/\s+/g,' ');
    return { buttons:[...document.querySelectorAll('button')].map(txt).filter(Boolean).slice(0,50),
             body:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,1200) };
  });
  console.log('\nBUTTONS:',JSON.stringify(d.buttons));
  console.log('\nBODY:',d.body);
  await pg.screenshot({path:'shot_draft.png'});
  await b.close();
})().catch(e=>{console.error('ERR',e);process.exit(1)});
