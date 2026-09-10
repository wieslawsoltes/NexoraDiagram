"""Real pointer/keyboard regression tests for drawing and page editing.

HTTP mode tests browser storage and a served modular build.
NEXORA_FIXTURE=1 uses the generated standalone document and injected persistence.
NEXORA_GPU=1 additionally requires actual WebGPU shader/command completion (HTTP only).
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
FIXTURE = os.getenv('NEXORA_FIXTURE') == '1'
GPU = os.getenv('NEXORA_GPU') == '1'
REPORT = {'mode': 'standalone fixture' if FIXTURE else 'HTTP modular app', 'gpuRequired': GPU, 'checks': [], 'errors': []}

def check(name, value, details=None):
    print(f'{name}: {bool(value)}', flush=True)
    REPORT['checks'].append({'name': name, 'passed': bool(value), 'details': details})
    assert value, f'{name}: {details}'

async def run():
    async with async_playwright() as pw:
        args = ['--no-sandbox']
        if GPU: args += ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--disable-vulkan-surface']
        browser = await pw.chromium.launch(headless=True, args=args, **({'executable_path': os.environ['CHROMIUM_PATH']} if os.getenv('CHROMIUM_PATH') else {}))
        context = await browser.new_context(viewport={'width': 1600, 'height': 1000}, accept_downloads=True)
        page = await context.new_page()
        page.on('pageerror', lambda error: REPORT['errors'].append(str(error)))
        if FIXTURE:
            await page.set_content((ROOT / 'dist/Nexora-Diagram.html').read_text(), wait_until='load')
        else:
            await page.goto(os.getenv('NEXORA_URL', 'http://127.0.0.1:8080') + ('' if GPU else '?renderer=canvas'), wait_until='networkidle')
        await page.wait_for_function('window.nexora && nexora.editor && nexora.routing.routes.size > 0')
        if FIXTURE:
            await page.evaluate("nexora.persistence = {save: async doc => window.__saved=structuredClone(doc)}")
        await page.evaluate("""() => { const a=nexora; a.cancelInteraction(); a.store.transact('Empty test canvas',()=>{a.page.graph={nodes:{},edges:{}};a.page.view={nodes:{},edges:{},nextZ:1};a.page.constraints=[];a.page.width=1320;a.page.height=900;a.page.originX=0;a.page.originY=0;a.page.canvasMode='fixed';});a.select([]);a.snap=false;a.maintainConstraints=false;a.camera.x=30;a.camera.y=30;a.camera.zoom=1;a.cameraChanged(); }""")
        async def evaluate(expression, argument=None):
            return await page.evaluate(expression, argument)
        async def point(x, y):
            return await evaluate("([x,y])=>{const p=nexora.worldToScreen({x,y}),r=document.getElementById('stage').getBoundingClientRect();return {x:p.x+r.left,y:p.y+r.top}}", [x,y])
        async def drag(start, end, modifiers=()):
            s,e=await point(*start),await point(*end)
            for key in modifiers: await page.keyboard.down(key)
            await page.mouse.move(s['x'],s['y']); await page.mouse.down()
            await page.mouse.move(e['x'],e['y'],steps=7); await page.mouse.up()
            for key in modifiers: await page.keyboard.up(key)
            await page.wait_for_timeout(70)
        async def click(x,y):
            p=await point(x,y); await page.mouse.click(p['x'],p['y'])
        async def tool(name): await evaluate('(t)=>nexora.setTool(t)',name)
        async def geometry(): return await evaluate('structuredClone(nexora.page.view.nodes[[...nexora.selection][0]])')
        async def selected(): return await evaluate('[...nexora.selection][0]')
        async def draw(name,start,end):
            await tool(name); await drag(start,end); return await selected()
        async def restore_camera(): await evaluate('Object.assign(nexora.camera,{x:30,y:30,zoom:1});nexora.cameraChanged()')

        line=await draw('line',(120,100),(370,100)); g=await geometry()
        check('horizontal line retains two editable endpoints and 1-unit zero-axis envelope',g.get('pathMode')=='linear' and len(g.get('path',[]))==2 and g['h']==1,g)
        before=await evaluate('nexora.store.undoStack.length')
        await evaluate("nexora.action('undo')")
        check('one undo removes a complete drawing gesture',not await evaluate('(id)=>!!nexora.page.graph.nodes[id]',line))
        await evaluate("nexora.action('redo')")
        check('redo restores line geometry',await evaluate('(id)=>nexora.page.view.nodes[id].path.length===2',line))
        await evaluate('(id)=>nexora.select([id])',line)
        await tool('pointer')
        await drag((370,100),(400,135)); g=await geometry()
        check('free line endpoint can be repositioned',abs(g['w']-280)<.01 and abs(g['h']-35)<.01,g)
        rectangle=await draw('rectangle',(120,220),(260,320)); original=await geometry()
        await tool('pointer')
        check('all eight resize grips are visible',await page.locator('[data-grip]').count()==9)
        for handle,fx,fy,dx,dy in [('n',.5,0,0,-20),('e',1,.5,25,0),('s',.5,1,0,20),('w',0,.5,-25,0),('nw',0,0,-20,-20),('ne',1,0,20,-20),('se',1,1,20,20),('sw',0,1,-20,20)]:
            await evaluate('([id,g])=>{Object.assign(nexora.page.view.nodes[id],g);nexora.select([id]);nexora.requestFrame(true)}',[rectangle,original])
            start=(original['x']+original['w']*fx,original['y']+original['h']*fy)
            await drag(start,(start[0]+dx,start[1]+dy)); changed=await geometry()
            valid = changed['w']>original['w'] if dx else abs(changed['w']-original['w'])<.01
            valid = valid and (changed['h']>original['h'] if dy else abs(changed['h']-original['h'])<.01)
            check('resize '+handle+' changes only the intended axes',valid,changed)
        await evaluate('([id,g])=>{Object.assign(nexora.page.view.nodes[id],g);nexora.select([id]);nexora.requestFrame(true)}',[rectangle,original])
        await drag((260,320),(330,370),('Shift',)); g=await geometry()
        check('Shift resize preserves aspect ratio',abs(g['w']/g['h']-1.4)<.001,g)
        await evaluate('([id,g])=>{Object.assign(nexora.page.view.nodes[id],g);nexora.select([id]);nexora.requestFrame(true)}',[rectangle,original])
        await drag((260,270),(295,270),('Alt',)); g=await geometry()
        check('Alt side resize preserves the center',abs(g['x']+g['w']/2-190)<.001 and abs(g['w']-210)<.01,g)
        await evaluate('([id,g])=>{Object.assign(nexora.page.view.nodes[id],g);nexora.select([id]);nexora.requestFrame(true)}',[rectangle,original])
        await evaluate("nexora.action('rotate-right')"); g=await geometry()
        check('rotation is an actual geometry transform',g['rotation']==90,g)
        await evaluate("nexora.action('undo')")
        # Draw a curve and verify editable control handles.
        curve=await draw('bezier',(400,220),(630,270)); g=await geometry()
        check('cubic curve stores four exact control points',g['pathMode']=='cubic' and len(g['path'])==4,g)
        await evaluate("nexora.action('edit-points')")
        check('curve control-point handles are exposed',await page.locator('[data-grip^="point-"]').count()==4)
        arc=await draw('arc',(400,350),(650,380)); g=await geometry()
        check('arc stores quadratic controls',g['pathMode']=='quadratic' and len(g['path'])==3,g)
        await tool('pencil')
        start=await point(130,430); await page.mouse.move(start['x'],start['y']); await page.mouse.down()
        for x,y in [(155,410),(180,450),(210,400),(260,455),(300,420)]:
            p=await point(x,y); await page.mouse.move(p['x'],p['y'],steps=3)
        await page.mouse.up(); g=await geometry()
        check('freehand stroke is an editable multi-vertex path',len(g.get('path',[]))>4 and g['pathMode']=='linear',g)
        await tool('polygon')
        for x,y in [(440,450),(540,440),(600,500),(500,535)]: await click(x,y)
        await page.keyboard.press('Enter'); polygon=await selected(); g=await geometry()
        check('click polygon commits a closed filled path',g['closed'] and len(g['path'])==4,g)
        await tool('pointer'); await evaluate("nexora.action('edit-points')"); await evaluate("nexora.action('insert-point')")
        check('linear path vertex insertion is persistent',len((await geometry())['path'])==5)
        await evaluate("nexora.action('delete-point')")
        check('linear path vertex deletion is persistent',len((await geometry())['path'])==4)
        # Style fields actually modify geometry/scene; no isolated drawing overlay.
        await page.locator('[data-draw-style="dash"]').select_option('dashdot')
        await page.locator('[data-draw-style="strokeWidth"]').fill('5')
        await page.locator('[data-draw-style="strokeWidth"]').press('Tab')
        await page.locator('[data-draw-style="lineJoin"]').select_option('bevel')
        await page.locator('[data-draw-style="opacity"]').fill('0.7')
        await page.locator('[data-draw-style="opacity"]').press('Tab')
        g=await geometry()
        check('stroke patterns, weights, joins and opacity modify the document',g['dash']=='dashdot' and g['strokeWidth']==5 and g['lineJoin']=='bevel' and g['opacity']==.7,g)
        await evaluate('nexora.requestFrame(true)'); await page.wait_for_timeout(80)
        check('display list contains stroke style rather than an overlay',await evaluate('(id)=>nexora.renderer.scene.primitives.some(p=>p.id===id&&p.dashArray.length===4&&p.opacity===.7)',polygon))
        # Select-all movement from blank space inside the bounding rectangle.
        await evaluate("nexora.action('select-all')"); await tool('pointer')
        originals=await evaluate('Object.fromEntries(Object.entries(nexora.page.view.nodes).map(([id,g])=>[id,{x:g.x,y:g.y}]))')
        await drag((330,340),(365,362)); positions=await evaluate('nexora.page.view.nodes')
        check('select-all drags from empty space within selection bounds',all(abs(positions[id]['x']-g['x']-35)<.01 and abs(positions[id]['y']-g['y']-22)<.01 for id,g in originals.items()))
        await evaluate("nexora.action('group')"); group=await selected()
        check('group command creates persistent ownership',await evaluate('(id)=>nexora.page.graph.nodes[id]?.master==="group" && Object.values(nexora.page.graph.nodes).filter(n=>n.parentId===id).length>=6',group))
        await page.keyboard.press('ArrowRight')
        await evaluate("nexora.action('ungroup')")
        check('ungroup restores the member selection',await evaluate('nexora.selection.size>=6'))
        # Cancel drawing and movement without dirty transactions.
        await tool('line'); count=await evaluate('Object.keys(nexora.page.graph.nodes).length'); s=await point(100,600); e=await point(300,610)
        await page.mouse.move(s['x'],s['y']); await page.mouse.down(); await page.mouse.move(e['x'],e['y']); await page.keyboard.press('Escape'); await page.mouse.up()
        check('Escape cancels an unfinished stroke without a history transaction',await evaluate('!nexora.store.pending && Object.keys(nexora.page.graph.nodes).length')==count)
        await tool('pointer'); await evaluate('(id)=>nexora.select([id])',rectangle)
        original=await geometry(); await evaluate("nexora.action('lock-selection')")
        await drag((original['x']+50,original['y']+50),(original['x']+90,original['y']+90))
        g=await evaluate('(id)=>nexora.page.view.nodes[id]',rectangle)
        check('object locking prevents drag movement',g['x']==original['x'] and g['y']==original['y'])
        await evaluate('(id)=>nexora.select([id])',rectangle); await evaluate("nexora.action('unlock-selection')")
        # Infinite mode and persistence of explicit settings.
        await evaluate("nexora.action('page-setup')")
        await page.locator('#page-mode').select_option('infinite')
        await page.locator('#page-units').select_option('mm')
        await page.locator('#page-preset').select_option('A3')
        await page.locator('#page-orientation').select_option('landscape')
        await page.locator('#page-grid').fill('20')
        await page.locator('#dialog-footer button[type="submit"]').click()
        check('page setup applies infinite mode, units, orientation, preset and grid',await evaluate("nexora.page.canvasMode==='infinite' && nexora.page.units==='mm' && nexora.page.width>nexora.page.height && nexora.page.gridSize===20"))
        await restore_camera()
        await evaluate('nexora.camera.x=350;nexora.camera.y=330;nexora.cameraChanged()')
        neg=await draw('line',(-220,-190),(-70,-110))
        check('infinite canvas accepts negative drawing coordinates',(await geometry())['x']<0)
        async with page.expect_download() as event:
            await evaluate("nexora.action('export-svg')")
        download=await event.value; path=await download.path(); source=Path(path).read_text()
        import re
        view=re.search(r'viewBox="([^"]+)"',source).group(1).split()
        check('infinite SVG export uses finite bounds including negative coordinates',float(view[0])<0 and float(view[1])<0 and float(view[2])>500,view)
        check('SVG preserves dashes, joins, opacity and object identities','stroke-dasharray="20 10 5 10"' in source and 'stroke-linejoin="bevel"' in source and 'opacity="0.7"' in source and 'data-nexora-id' in source)
        async with page.expect_download() as event:
            await evaluate("nexora.action('export-selection')")
        download=await event.value; path=await download.path(); check('selection export downloads valid SVG',Path(path).read_text().startswith('<?xml'))
        async with page.expect_download() as event:
            await evaluate("nexora.action('export-png')")
        download=await event.value; path=await download.path(); check('PNG export encodes a real raster',Path(path).read_bytes().startswith(b'\x89PNG\r\n\x1a\n'))
        await evaluate("nexora.action('duplicate-page')")
        check('page duplication preserves infinite mode and measurement settings',await evaluate("nexora.page.canvasMode==='infinite' && nexora.page.units==='mm' && nexora.page.gridSize===20"))
        await evaluate("nexora.action('fit-content')")
        check('fit-page-to-content includes negative origins',await evaluate("nexora.page.canvasMode==='fixed' && nexora.page.originX<0 && nexora.page.originY<0"))
        # Actual app persistence only in HTTP mode; fixture checks are explicitly not storage proof.
        await evaluate('nexora.autosave()')
        if not FIXTURE:
            state=await evaluate('JSON.stringify(nexora.doc)'); await page.reload(wait_until='networkidle'); await page.wait_for_function('window.nexora && nexora.editor'); check('HTTP reload restores drawing and page data from storage',await evaluate('JSON.stringify(nexora.doc)')==state)
        await evaluate("nexora.ui.tab='Draw';nexora.ui.renderTabs();nexora.ui.renderRibbon();nexora.fitPage();document.getElementById('toast').hidden=true")
        await page.screenshot(path=str(OUT/'drawing-desktop.png'),full_page=True)
        await page.set_viewport_size({'width':390,'height':844}); await page.wait_for_timeout(100); await evaluate('nexora.fitPage()'); await page.screenshot(path=str(OUT/'drawing-mobile.png'),full_page=True)
        check('mobile retains a usable canvas',await evaluate('nexora.camera.width>100 && nexora.camera.height>150'))
        if GPU:
            await page.wait_for_function("nexora.renderer.mode==='WebGPU'",timeout=15000)
            await evaluate('nexora.renderer.backend.device.queue.onSubmittedWorkDone()')
            check('real WebGPU backend completed drawing commands',await evaluate("nexora.renderer.mode==='WebGPU'"))
        REPORT['backend']=await evaluate('nexora.renderer.mode')
        check('no uncaught application errors',not REPORT['errors'],REPORT['errors'])
        await browser.close()

try:
    asyncio.run(run())
finally:
    (OUT/('editor-gpu.json' if GPU else 'editor-browser.json')).write_text(json.dumps(REPORT,indent=2))
