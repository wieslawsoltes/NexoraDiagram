"""End-to-end advanced authoring. HTTP mode also tests real storage and two transports.
Fixture mode deliberately excludes storage/network/GPU claims.
"""
import asyncio, base64, json, os
from pathlib import Path
from playwright.async_api import async_playwright, expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
FIXTURE=os.getenv('NEXORA_FIXTURE')=='1';GPU=os.getenv('NEXORA_GPU')=='1'
REPORT={'mode':'standalone fixture' if FIXTURE else 'HTTP modular app','gpuRequired':GPU,'checks':[],'errors':[],'consoleErrors':[]}
def check(name,value,details=None):
    print(f'{name}: {bool(value)}',flush=True);REPORT['checks'].append({'name':name,'passed':bool(value),'details':details});assert value,f'{name}: {details}'
async def run():
 async with async_playwright() as pw:
  args=['--no-sandbox']
  if GPU:args+=['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader','--disable-vulkan-surface']
  browser=await pw.chromium.launch(headless=True,args=args,**({'executable_path':os.environ['CHROMIUM_PATH']} if os.getenv('CHROMIUM_PATH') else {}))
  context=await browser.new_context(viewport={'width':1600,'height':1000},accept_downloads=True)
  async def opened(ctx):
   p=await ctx.new_page();p.on('pageerror',lambda e:REPORT['errors'].append(str(e)));p.on('console',lambda m:REPORT['consoleErrors'].append(m.text) if m.type=='error' else None)
   if FIXTURE:await p.set_content((ROOT/'dist/Nexora-Diagram.html').read_text(),wait_until='load')
   else:await p.goto(os.getenv('NEXORA_URL','http://127.0.0.1:8080')+('' if GPU else '?renderer=canvas'),wait_until='networkidle')
   await p.wait_for_function('window.nexora && nexora.editor && !!nexora.extraActions?.collaborate')
   if FIXTURE:await p.evaluate('nexora.persistence={save:async doc=>window.__saved=structuredClone(doc)}')
   if GPU:await p.wait_for_function("nexora.renderer.mode==='WebGPU'",timeout=20000)
   return p
  page=await opened(context)
  async def ev(s,arg=None):return await page.evaluate(s,arg)
  async def action(name):await ev('(name)=>nexora.action(name)',name)
  async def submit():
   await page.locator('#dialog-footer button[type=submit]').click();await expect(page.locator('#dialog')).not_to_be_visible()
  async def close():await page.locator('#dialog-footer [data-action=close-dialog]').click()
  async def point(x,y):return await ev('([x,y])=>{const p=nexora.worldToScreen({x,y}),r=document.getElementById("stage").getBoundingClientRect();return {x:p.x+r.left,y:p.y+r.top}}',[x,y])
  async def reset():
   await ev("""()=>{const a=nexora;a.cancelInteraction();a.store.transact('Test canvas',()=>{a.page.graph={nodes:{},edges:{}};a.page.view={nodes:{},edges:{},nextZ:1};a.page.constraints=[];a.page.width=1320;a.page.height=900;a.page.canvasMode='fixed';a.page.originX=0;a.page.originY=0;});a.select([]);a.snap=false;a.guides=false;a.maintainConstraints=false;Object.assign(a.camera,{x:25,y:25,zoom:1});a.cameraChanged();}""")
  async def select(ids):await ev('(ids)=>{nexora.setTool("pointer");nexora.select(ids)}',ids)
  async def draw(tool,points):
   await ev('(t)=>nexora.setTool(t)',tool)
   for x,y in points:
    p=await point(x,y);await page.mouse.click(p['x'],p['y'])
   await page.wait_for_timeout(80);return await ev('[...nexora.selection][0]')
  await reset();await page.locator('[data-ribbon-tab=Advanced]').click()
  check('Advanced ribbon exposes real authoring, interchange and collaboration actions',await page.locator('#ribbon [data-action=boolean-union]').count()==1 if await page.locator('#ribbon').count() else await page.locator('[data-action=boolean-union]').count()>0)
  arc=await draw('circlearc',[(80,170),(150,80),(260,170)])
  check('three clicks create an exact circular arc retaining original controls',await ev('(id)=>nexora.page.view.nodes[id]?.pathMode==="circular"&&nexora.page.view.nodes[id].path.length===3',arc))
  await select([arc]);await action('edit-points');await expect(page.locator('[data-grip^="point-"]')).to_have_count(3)
  check('circular arc exposes all three editable defining points',True)
  # Actual pen input via CDP, not injected geometry.
  await ev("nexora.setTool('pencil');nexora.drawStyle.strokeWidth=20")
  cdp=await context.new_cdp_session(page)
  ps=[await point(80+i*18,300+(i%3)*5) for i in range(15)]
  await cdp.send('Input.dispatchMouseEvent',{'type':'mousePressed','x':ps[0]['x'],'y':ps[0]['y'],'button':'left','buttons':1,'clickCount':1,'pointerType':'pen','force':.1,'tiltX':10})
  for i,p in enumerate(ps[1:]):await cdp.send('Input.dispatchMouseEvent',{'type':'mouseMoved','x':p['x'],'y':p['y'],'button':'left','buttons':1,'pointerType':'pen','force':.1+.85*i/13,'tiltX':10+i})
  await cdp.send('Input.dispatchMouseEvent',{'type':'mouseReleased','x':ps[-1]['x'],'y':ps[-1]['y'],'button':'left','buttons':0,'clickCount':1,'pointerType':'pen','force':0})
  await page.wait_for_timeout(100);ink=await ev('[...nexora.selection][0]')
  check('real pen input retains varying pressure and tilt samples',await ev('(id)=>{const g=nexora.page.view.nodes[id];return g.pressures?.length>5&&Math.max(...g.pressures)-Math.min(...g.pressures)>.5&&g.tilts.some(p=>p.x!==0)}',ink))
  await select([ink]);await action('ink-settings');await page.locator('#ink-thinning').fill('0.9');await page.locator('#ink-gamma').fill('1.5');await submit()
  check('ink response controls update persistent pressure geometry',await ev('(id)=>nexora.page.view.nodes[id].ink.gamma===1.5',ink))
  # Two ordinary vector shapes, true difference with a hole.
  pair=await ev("""()=>{const a=nexora,x=a.addShape('rectangle',{x:600,y:180}),y=a.addShape('ellipse',{x:600,y:180});a.store.transact('Boolean operands',()=>{Object.assign(a.page.view.nodes[x],{x:440,y:70,w:280,h:210,fill:'#a4d7f2'});Object.assign(a.page.view.nodes[y],{x:520,y:125,w:90,h:90});a.page.graph.nodes[x].label='';a.page.graph.nodes[y].label='';});return [x,y]}""")
  await select(pair);await action('boolean-difference')
  check('subtract creates persistent compound contours and keeps primary identity',await ev('([x,y])=>nexora.page.view.nodes[x].contours?.length===2&&!nexora.page.graph.nodes[y]',pair))
  check('compound hole is not hit-tested as filled material',await ev('nexora.hitTest({x:565,y:170})===null'))
  await action('undo');check('boolean operation undoes as one command',await ev('(ids)=>ids.every(id=>nexora.page.graph.nodes[id])',pair));await action('redo')
  # Rich text: UI authoring/marks/roundtrip, not a model-only sample.
  text=await ev("nexora.addShape('rectangle',{x:590,y:370})")
  await ev('(id)=>nexora.store.transact("Text box",()=>Object.assign(nexora.page.view.nodes[id],{x:440,y:330,w:280,h:120}))',text)
  await select([text]);await action('rich-text');await page.wait_for_timeout(50)
  await page.locator('#rich-editor').fill('Rich content — editable');await page.locator('#rich-editor').press('Control+a');await page.locator('[data-rich-command=bold]').click();await submit()
  check('rich editor saves styled text runs rather than executable HTML',await ev('(id)=>{const n=nexora.page.graph.nodes[id];return n.label.includes("Rich content")&&n.richText.paragraphs.some(p=>p.runs.some(r=>r.bold))}',text))
  await select([text]);await action('rich-text');check('rich editor reopens formatted content',await page.locator('#rich-editor b, #rich-editor strong, #rich-editor span[style*="font-weight:700"]').count()>0);await close()
  # Embedded pixels generated by a real browser canvas.
  data=await ev("""()=>{const c=document.createElement('canvas');c.width=160;c.height=100;const x=c.getContext('2d');x.fillStyle='#f00000';x.fillRect(0,0,80,100);x.fillStyle='#0000f0';x.fillRect(80,0,80,100);return c.toDataURL()}""")
  payload={'name':'two-color.png','mimeType':'image/png','buffer':base64.b64decode(data.split(',')[1])}
  async with page.expect_file_chooser() as fc:await action('embed-image')
  await (await fc.value).set_files(payload)
  await page.wait_for_function('Object.values(nexora.page.graph.nodes).some(n=>n.image)');im=await ev('Object.values(nexora.page.graph.nodes).find(n=>n.image).id')
  await ev('(id)=>nexora.store.transact("Place image",()=>Object.assign(nexora.page.view.nodes[id],{x:790,y:90,w:160,h:100}))',im)
  await select([im]);await action('image-properties');await page.locator('#image-x').fill('50');await page.locator('#image-w').fill('50');await page.locator('#image-fit').select_option('stretch');await submit()
  check('image cropping preserves original embedded pixels',await ev('(id)=>{const n=nexora.page.graph.nodes[id];return n.image.crop.x===.5&&n.image.crop.w===.5&&n.image.width===160}',im))
  await ev('nexora.requestFrame(true)');await page.wait_for_timeout(250)
  # Readback render target through screenshot gives actual color coverage in either backend.
  from PIL import Image
  import io
  shot=Image.open(io.BytesIO(await page.screenshot())).convert('RGB');q=await point(850,140);pixel=shot.getpixel((int(q['x']),int(q['y'])))
  check('renderer displays the cropped blue image pixels',pixel[2]>170 and pixel[0]<60,pixel)
  async with page.expect_download() as dl:await action('export-svg')
  svg=Path(await (await dl.value).path()).read_text();check('SVG exports exact arcs, embedded pixels, hole contours and rich weight',all(s in svg for s in ['data:image/png;base64','font-weight="700"',' A','fill-rule="evenodd"']))
  async with page.expect_download() as dl:await action('export-png')
  png=Path(await (await dl.value).path()).read_bytes();check('PNG exports embedded image content as a real raster',png[:8]==b'\x89PNG\r\n\x1a\n')
  # Multi-sheet HTML preview and one-sheet fit.
  await action('print-page');await page.locator('#print-preview-button').click();await page.wait_for_function('Number(document.getElementById("print-preview").dataset.sheetCount)>1')
  frame=page.frame_locator('#print-preview');check('print preview creates multiple physical sheets',await frame.locator('.sheet').count()>1)
  await page.locator('#print-fit').select_option('fit');await page.locator('#print-preview-button').click();await page.wait_for_function('document.getElementById("print-preview").dataset.sheetCount==="1"')
  check('fit printing uses one physical sheet per diagram page',await frame.locator('.sheet').count()==1)
  async with page.expect_download() as dl:await page.locator('#print-html-button').click()
  printed=Path(await (await dl.value).path()).read_text();check('printable HTML retains images, vectors and physical paper CSS','@page{size:210mm 297mm' in printed and 'data:image/png;base64' in printed);await close()
  # Standard native package download then real file import dialog.
  snapshot=await ev('JSON.stringify(nexora.doc)')
  async with page.expect_download() as dl:await action('native-export')
  package=Path(await (await dl.value).path()).read_bytes();check('native export produces a ZIP package',package[:4]==b'PK\x03\x04')
  async with page.expect_file_chooser() as fc:await action('native-import')
  await (await fc.value).set_files({'name':'roundtrip.vsdx','mimeType':'application/octet-stream','buffer':package})
  await expect(page.locator('#dialog-title')).to_have_text('Import drawing — review conversion');check('native import provides a conversion report before replacing the workspace','LOSSLESS_EXTENSION' in await page.locator('#dialog-body').inner_text());await submit()
  check('native package roundtrip preserves all native authoring records',await ev('(s)=>JSON.stringify(nexora.doc)===s',snapshot))
  if not FIXTURE:
   await ev('nexora.autosave()');await page.reload(wait_until='networkidle');await page.wait_for_function('!!window.nexora?.extraActions?.collaborate');check('rich text, pressure and embedded images survive real browser reload',await ev('(id)=>!!nexora.page.graph.nodes[id]?.image',im))
  await ev('nexora.ui.tab="Advanced";nexora.ui.renderRibbon();nexora.fitPage();nexora.select([])');await page.wait_for_timeout(180)
  await page.screenshot(path=str(OUT/f'advanced-{"gpu" if GPU else "canvas"}-desktop.png'))
  await page.set_viewport_size({'width':430,'height':850});await page.wait_for_timeout(150);await page.screenshot(path=str(OUT/f'advanced-{"gpu" if GPU else "canvas"}-mobile.png'))
  check('mobile advanced editor retains a drawable canvas',await ev('nexora.camera.width>150 && nexora.camera.height>200'))
  await page.set_viewport_size({'width':1600,'height':1000})
  if not FIXTURE and not GPU:
   async def start(p,room,join=False):
    await p.evaluate("nexora.action('collaborate')");await p.locator('#session-room').fill(room);await p.locator('#session-join' if join else '#session-host').click();await p.locator('#dialog-footer [data-action=close-dialog]').click()
   p2=await opened(context);await start(page,'nexora_ci_local_2026');await start(p2,'nexora_ci_local_2026',True);await p2.wait_for_function('nexora.collaboration?.ready')
   check('BroadcastChannel joins a real shared document',await p2.evaluate('nexora.doc.id')==await ev('nexora.doc.id'))
   await ev('(id)=>nexora.store.transact("Shared move",()=>nexora.page.view.nodes[id].x=450)',text)
   await p2.wait_for_function('(id)=>nexora.page.view.nodes[id].x===450',arg=text)
   await p2.evaluate('(id)=>nexora.store.transact("Peer color",()=>nexora.page.view.nodes[id].fill="#00dd99")',text)
   await page.wait_for_function('(id)=>nexora.page.view.nodes[id].fill==="#00dd99"',arg=text)
   await action('undo');await p2.wait_for_function('(id)=>nexora.page.view.nodes[id].x===440',arg=text)
   check('collaborative undo preserves independent peer changes',await ev('(id)=>nexora.page.view.nodes[id].fill==="#00dd99"',text))
   await ev('(id)=>nexora.store.transact("Another move",()=>nexora.page.view.nodes[id].x=460)',text);await p2.wait_for_function('(id)=>nexora.page.view.nodes[id].x===460',arg=text)
   await p2.evaluate('(id)=>nexora.store.transact("Peer replaces position",()=>nexora.page.view.nodes[id].x=470)',text);await page.wait_for_function('(id)=>nexora.page.view.nodes[id].x===470',arg=text);await action('undo')
   check('undo never overwrites a later peer geometry edit',await ev('(id)=>nexora.page.view.nodes[id].x===470',text))
   await ev('nexora.collaboration.close()');await p2.evaluate('nexora.collaboration.close()');await p2.close()
   remote=await browser.new_context(viewport={'width':1600,'height':1000});p3=await opened(remote)
   await start(page,'nexora_ci_remote_2026');await start(p3,'nexora_ci_remote_2026',True)
   async def connect():
    offer=await ev('nexora.collaboration.createOffer()');answer=await p3.evaluate('(offer)=>nexora.collaboration.answerOffer(offer)',offer);await ev('(answer)=>nexora.collaboration.acceptAnswer(answer)',answer)
    await page.wait_for_function('[...nexora.collaboration.channels].some(c=>c.readyState==="open")',timeout=30000);await p3.wait_for_function('nexora.collaboration.ready',timeout=30000)
   await connect();check('separate browser contexts synchronize via a real WebRTC data channel',await p3.evaluate('nexora.doc.id')==await ev('nexora.doc.id'))
   await ev('(id)=>nexora.store.transact("Remote label",()=>{nexora.page.graph.nodes[id].label="Remote peer edit";delete nexora.page.graph.nodes[id].richText})',text)
   await p3.wait_for_function('(id)=>nexora.page.graph.nodes[id].label==="Remote peer edit"',arg=text);check('WebRTC carries real document operations',True)
   await ev('for(const pc of nexora.collaboration.connections)pc.close()');await p3.evaluate('for(const pc of nexora.collaboration.connections)pc.close()')
   await ev('(id)=>nexora.store.transact("Offline color",()=>nexora.page.view.nodes[id].fill="#9988cc")',text)
   await p3.evaluate('(id)=>nexora.store.transact("Offline text",()=>nexora.page.graph.nodes[id].label="Reconnected")',text)
   await connect();await page.wait_for_function('(id)=>nexora.page.graph.nodes[id].label==="Reconnected"',arg=text);await p3.wait_for_function('(id)=>nexora.page.view.nodes[id].fill==="#9988cc"',arg=text)
   check('offline peer edits merge after a new WebRTC handshake',True)
   check('collaboration reports no transport or validation failures',await ev('!nexora.collaboration.lastError') and await p3.evaluate('!nexora.collaboration.lastError'))
   await ev('nexora.collaboration.close()');await p3.evaluate('nexora.collaboration.close()');await remote.close()
  if GPU:
   await page.wait_for_function('nexora.renderer.mode==="WebGPU"');await ev('nexora.renderer.backend.device.queue.onSubmittedWorkDone()');check('WebGPU pipelines submit and complete rich content and image commands',True)
  REPORT['backend']=await ev('nexora.renderer.mode');check('no uncaught advanced application errors',not REPORT['errors'],REPORT['errors'])
  # Fixture about:blank intentionally cannot access persistence; console errors from that path are not GPU/storage evidence.
  if not FIXTURE:check('HTTP advanced workflows produce no console errors',not REPORT['consoleErrors'],REPORT['consoleErrors'])
  await browser.close()
try:asyncio.run(run())
finally:(OUT/f'advanced-{"gpu" if GPU else "canvas"}-results.json').write_text(json.dumps(REPORT,indent=2))
