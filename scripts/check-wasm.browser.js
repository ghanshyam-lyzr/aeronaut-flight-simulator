// Run with the browser MCP's browser_run_code_unsafe filename argument.
// Keep a controlled clock so software WebGL can verify real flight controls.
async (page) => {
  await page.goto('about:blank');
  const browser = page.context().browser(), results = [], errors = [];
  const context = await browser.newContext({viewport:{width:1600,height:900}});
  await context.addInitScript(() => {
    localStorage.setItem('aeronaut-settings',JSON.stringify({version:2,quality:'low',muted:true}));
    window.__simNow=1000;
    Object.defineProperty(performance,'now',{value:()=>window.__simNow});
    Object.defineProperty(Event.prototype,'timeStamp',{get:()=>window.__simNow});
    window.__frames=[];window.requestAnimationFrame=cb=>window.__frames.push(cb);
    window.__step=()=>{window.__simNow+=250;window.__frames.splice(0).forEach(cb=>cb(window.__simNow));};
  });
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  try {
    await p.goto('http://localhost:5173',{waitUntil:'domcontentloaded',timeout:60000});
    await p.waitForFunction(()=>!!window.aeronaut,null,{timeout:60000,polling:100});
    const initial=await p.evaluate(()=>({engine:aeronaut.getEngine(),state:aeronaut.getState()}));
    check(initial.engine.backend==='webassembly'&&initial.engine.terrain==='webassembly','native engine not selected');
    for(const id of ['trainer','fighter','tandem']) {
      await p.evaluate(id=>{aeronaut.setAircraft(id);aeronaut.setWind('gusts');aeronaut.setPaused(false);},id);
      const before=await p.evaluate(()=>aeronaut.getState().flightTime);
      await p.keyboard.down('KeyD');await p.evaluate(()=>__step());await p.keyboard.up('KeyD');
      const after=await p.evaluate(()=>{__step();return aeronaut.getState();});
      check(after.flightTime>before&&!after.crashed&&Number.isFinite(after.gForce),`${id}: flight failed`);
      results.push({aircraft:id,flightTime:after.flightTime,bank:after.bank,engine:await p.evaluate(()=>aeronaut.getEngine())});
    }
    for(const [width,height] of [[1600,900],[1280,800],[390,844]]) {
      await p.setViewportSize({width,height});
      await p.evaluate(()=>{aeronaut.setPaused(true);__step();});
      const layout=await p.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,canvas:document.querySelector('#world canvas').getBoundingClientRect().toJSON()}));
      check(layout.scrollWidth<=width&&layout.canvas.bottom<=height+1,`viewport overflow ${width}`);
      await p.screenshot({path:`/tmp/forge-browser/wasm-${width}.png`,fullPage:false});
      results.push(layout);
    }
    await p.route('**/*.wasm',route=>route.abort());
    await p.reload({waitUntil:'domcontentloaded',timeout:60000});
    await p.waitForFunction(()=>!!window.aeronaut,null,{timeout:60000,polling:100});
    const fallback=await p.evaluate(()=>{__step();return {engine:aeronaut.getEngine(),state:aeronaut.getState()};});
    check(fallback.engine.backend==='javascript'&&!fallback.state.crashed,'JavaScript fallback failed');
    results.push({fallback:fallback.engine});check(errors.length===0,JSON.stringify(errors));
    return {results,errors};
  } finally {await context.close();}
}
