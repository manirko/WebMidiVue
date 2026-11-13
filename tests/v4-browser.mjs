import assert from 'node:assert/strict';

export async function testStageLayout(page, viewport, faultControl) {
  const selectors=['.play-brand','#sound','#volume','#stop','#connect','#settings-open','#help-open','#fullscreen'];
  const header=async()=>{
    const boxes=[];
    for (const selector of selectors) {
      const control=page.locator('.play-top '+selector);
      assert.equal(await control.isVisible(),true,selector);
      const box=await control.boundingBox(); boxes.push(box);
      assert(box.width>0 && box.height>0 && box.x>=0 && box.y>=0 && box.x+box.width<=viewport.width && box.y+box.height<=viewport.height,selector);
      assert.equal(await control.evaluate(el=>{
        const r=el.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return el===hit || el.contains(hit);
      }),true,selector+' is covered');
    }
    const centerY=box=>box.y+box.height/2;
    if (viewport.width>900) {
      assert(boxes.every(box=>Math.abs(centerY(box)-centerY(boxes[0]))<1),'desktop header row');
      assert(boxes.every((box,i)=>i===0 || box.x>=boxes[i-1].x+boxes[i-1].width),'desktop header order');
    } else {
      for (const index of [2,3,4]) assert(Math.abs(centerY(boxes[index])-centerY(boxes[0]))<1,'first phone row');
      for (const index of [5,6,7]) assert(Math.abs(centerY(boxes[index])-centerY(boxes[1]))<1,'second phone row');
      assert(boxes[1].y>=boxes[0].y+boxes[0].height,'phone has two rows');
    }
  };
  for (const selector of selectors) await faultControl(header,
    ()=>page.locator(selector).evaluate(el=>el.hidden=true),
    ()=>page.locator(selector).evaluate(el=>el.hidden=false));
  await faultControl(header,()=>page.locator('#stop').evaluate(el=>el.style.transform='translateY(20px)'),
    ()=>page.locator('#stop').evaluate(el=>el.style.removeProperty('transform')));
  const stage=async()=>{
    for (const selector of ['#instrument','#garden']) {
      const box=await page.locator(selector).boundingBox();
      assert.deepEqual(box,{x:0,y:0,width:viewport.width,height:viewport.height},selector);
    }
    assert.equal(await page.locator('#garden .orb').isVisible(),true);
    assert.equal(await page.locator('main h1,.sound-lab__reveal-copy').count(),0);
  };
  await faultControl(stage,()=>page.locator('#garden').evaluate(el=>el.style.width='50%'),
    ()=>page.locator('#garden').evaluate(el=>el.style.removeProperty('width')));
  await faultControl(stage,()=>page.locator('.orb').evaluate(el=>el.hidden=true),
    ()=>page.locator('.orb').evaluate(el=>el.hidden=false));
  const keys=async()=>{
    const rows=await page.locator('#keyboard button').evaluateAll(keys=>{
      const rows=new Map();
      for (const key of keys) {
        const r=key.getBoundingClientRect();
        if (!rows.has(r.y)) rows.set(r.y,[]);
        rows.get(r.y).push({letter:key.textContent,x:r.x,width:r.width});
      }
      return [...rows].sort((a,b)=>a[0]-b[0]).map(([,keys])=>keys.sort((a,b)=>a.x-b.x));
    });
    assert.deepEqual(rows.map(row=>row.map(key=>key.letter)),[['W','E','T','Y','U'],['A','S','D','F','G','H','J','K']]);
    assert(rows[0][0].x>rows[1][0].x && rows[0][0].x<rows[1][1].x,'W between A and S');
    assert(rows[0][2].x>rows[1][3].x && rows[0][2].x<rows[1][4].x,'T between F and G');
    assert(rows.flat().every(key=>key.x>=0 && key.x+key.width<=viewport.width),'keys fit the stage');
  };
  await faultControl(keys,()=>page.locator('[data-key=KeyW]').evaluate(el=>el.style.gridRow='2'),
    ()=>page.locator('[data-key=KeyW]').evaluate(el=>el.style.removeProperty('grid-row')));
  await page.screenshot({path:new URL(`../.artifacts/browser/header-${viewport.width}x${viewport.height}.png`,import.meta.url).pathname});
  await page.locator('#fullscreen').click();
  await page.waitForFunction(()=>Boolean(document.fullscreenElement));
  await faultControl(async()=>assert.equal(await page.locator('#fullscreen').getAttribute('aria-pressed'),'true'),
    ()=>page.locator('#fullscreen').evaluate(el=>el.setAttribute('aria-pressed','false')),
    ()=>page.locator('#fullscreen').evaluate(el=>el.setAttribute('aria-pressed','true')));
  await page.locator('#fullscreen').click();
  await page.waitForFunction(()=>!document.fullscreenElement);
  await faultControl(async()=>assert.equal(await page.locator('#fullscreen').getAttribute('aria-pressed'),'false'),
    ()=>page.locator('#fullscreen').evaluate(el=>el.setAttribute('aria-pressed','true')),
    ()=>page.locator('#fullscreen').evaluate(el=>el.setAttribute('aria-pressed','false')));
}

export async function testConnectionStatus(page, expected, faultControl) {
  await page.waitForFunction(expected=>document.querySelector('#connection-status').textContent===expected,expected);
  await faultControl(async()=>assert.equal(await page.locator('.play-top #connection-status').textContent(),expected),
    ()=>page.locator('#connection-status').evaluate(el=>el.textContent='wrong status'),
    ()=>page.locator('#connection-status').evaluate((el,text)=>el.textContent=text,expected));
}
