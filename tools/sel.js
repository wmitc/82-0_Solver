const { chromium } = require('playwright-core');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const ctx=await b.newContext();
  await ctx.addInitScript(()=>{window.__forceRand=null;const o=Math.random.bind(Math);Math.random=()=>window.__forceRand!==null?window.__forceRand:o();});
  const pg=await ctx.newPage();
  pg.on('console',m=>{const t=m.text();if(t.includes('[v0]'))console.log('LOG>',t);});
  await pg.goto('https://www.82-0.com',{waitUntil:'networkidle',timeout:60000});
  await sleep(1500);
  const clickText=(labels)=>pg.evaluate(labels=>{const n=s=>(s||'').trim().toLowerCase();const B=[...document.querySelectorAll('button')];for(const l of labels){const e=B.find(b=>n(b.innerText)===n(l));if(e){e.click();return l;}}return null;},labels);
  await clickText(['Accept']);await sleep(300);
  await clickText(["Don't Show Again"]);await sleep(300);
  await clickText(['Play Classic']);await sleep(3000);
  await clickText(["Don't Show Again","Close"]);await sleep(800);
  await pg.evaluate(v=>{window.__forceRand=v;},(56+0.5)/180); // GSW 1960s
  await clickText(['SPIN']); await sleep(3500);
  await pg.evaluate(()=>{window.__forceRand=null;});
  // Inspect the player rows: find element containing "Wilt Chamberlain"
  const before = await pg.evaluate(()=>{
    const rows=[...document.querySelectorAll('*')].filter(e=>e.childElementCount<=6 && /Wilt Chamberlain/.test(e.innerText||'') );
    return rows.slice(0,3).map(e=>({tag:e.tagName,cls:e.className,txt:(e.innerText||'').replace(/\s+/g,' ').slice(0,80)}));
  });
  console.log('WILT ROW CANDIDATES:',JSON.stringify(before,null,1));
  // click the Wilt row (clickable ancestor)
  await pg.evaluate(()=>{
    const els=[...document.querySelectorAll('div,button,li')].filter(e=>/Wilt Chamberlain/.test(e.innerText||'') && e.childElementCount<=8);
    // pick smallest
    els.sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length);
    if(els[0]) els[0].click();
  });
  await sleep(1500);
  const after=await pg.evaluate(()=>{
    const txt=el=>(el.innerText||'').trim().replace(/\s+/g,' ');
    return {buttons:[...document.querySelectorAll('button')].map(txt).filter(Boolean).slice(0,40),
            body:(document.body.innerText||'').replace(/\s+/g,' ').slice(0,700)};
  });
  console.log('\nAFTER CLICK WILT:');
  console.log('BUTTONS:',JSON.stringify(after.buttons));
  console.log('BODY:',after.body);
  await pg.screenshot({path:'shot_select.png',fullPage:true});
  await b.close();
})().catch(e=>{console.error('ERR',e);process.exit(1)});
