const { chromium } = require('playwright-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const pg=await b.newPage();
  pg.on('console',m=>{const t=m.text(); if(t.includes('[v0]')) console.log('LOG>',t);});
  await pg.goto('https://www.82-0.com',{waitUntil:'networkidle',timeout:60000});
  await sleep(1500);
  const clickText=(labels)=>pg.evaluate(labels=>{const n=s=>(s||'').trim().toLowerCase();const B=[...document.querySelectorAll('button')];for(const l of labels){const e=B.find(b=>n(b.innerText)===n(l));if(e){e.click();return l;}}return null;},labels);
  await clickText(['Accept']); await sleep(400);
  await clickText(["Don't Show Again"]); await sleep(400);
  await clickText(['Play Classic']); await sleep(3000);
  await clickText(["Don't Show Again","Close"]); await sleep(1000);
  console.log('--- SPIN ---');
  await clickText(['SPIN']);
  await sleep(4500);
  const d=await pg.evaluate(()=>{
    const txt=el=>(el.innerText||'').trim().replace(/\s+/g,' ');
    return { buttons:[...document.querySelectorAll('button')].map(txt).filter(Boolean).slice(0,60),
             body:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,1500) };
  });
  console.log('BUTTONS:',JSON.stringify(d.buttons));
  console.log('\nBODY:',d.body);
  await pg.screenshot({path:'shot_afterspin.png',fullPage:true});
  await b.close();
})().catch(e=>{console.error('ERR',e);process.exit(1)});
