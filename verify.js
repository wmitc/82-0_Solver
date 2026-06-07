const { chromium } = require('playwright-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const ctx=await b.newContext();
  // install Math.random hook before any page script
  await ctx.addInitScript(()=>{
    window.__forceRand=null;
    const orig=Math.random.bind(Math);
    Math.random=()=>window.__forceRand!==null?window.__forceRand:orig();
  });
  const pg=await ctx.newPage();
  let lastCombo=null;
  pg.on('console',m=>{const t=m.text(); if(t.includes('Valid combination selected')) {lastCombo=t; console.log('LOG>',t);}});
  await pg.goto('https://www.82-0.com',{waitUntil:'networkidle',timeout:60000});
  await sleep(1500);
  const clickText=(labels)=>pg.evaluate(labels=>{const n=s=>(s||'').trim().toLowerCase();const B=[...document.querySelectorAll('button')];for(const l of labels){const e=B.find(b=>n(b.innerText)===n(l));if(e){e.click();return l;}}return null;},labels);
  await clickText(['Accept']); await sleep(300);
  await clickText(["Don't Show Again"]); await sleep(300);
  await clickText(['Play Classic']); await sleep(3000);
  await clickText(["Don't Show Again","Close"]); await sleep(800);
  // Force index 56 => v=(56+0.5)/180
  const testIdx=[56];
  for(const idx of testIdx){
    const v=(idx+0.5)/180;
    await pg.evaluate(v=>{window.__forceRand=v;}, v);
    await clickText(['SPIN']);
    await sleep(3500);
    await pg.evaluate(()=>{window.__forceRand=null;});
    console.log(`predicted idx ${idx} -> expect combos[idx]`);
    // need to get back to spin: there's no re-spin in same round; so just do round1 once.
    break; // only test first round index 56
  }
  await b.close();
})().catch(e=>{console.error('ERR',e);process.exit(1)});
