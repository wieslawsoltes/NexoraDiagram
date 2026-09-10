"""Browser integration tests.

Normal mode (tests the modular HTTP app and real browser storage):
  pip install playwright
  playwright install chromium
  npm start
  NEXORA_URL=http://127.0.0.1:8080 python tests/browser_test.py

Restricted-runner fixture mode (no navigation, Canvas + real Blob worker;
uses injected in-memory persistence, not a storage or WebGPU test):
  npm run build
  NEXORA_FIXTURE=1 CHROMIUM_PATH=/usr/bin/chromium python tests/browser_test.py
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
FIXTURE = os.getenv('NEXORA_FIXTURE') == '1'
REPORT = {'mode': 'in-memory Canvas fixture' if FIXTURE else 'HTTP application', 'checks': [], 'errors': [], 'consoleErrors': []}

def check(name, condition, details=None):
    print(f'CHECK: {name} -> {bool(condition)}', flush=True)
    REPORT['checks'].append({'name': name, 'passed': bool(condition), **({'details': details} if details is not None else {})})
    if not condition:
        raise AssertionError(f'{name}: {details}')

async def main():
    async with async_playwright() as pw:
        executable = os.getenv('CHROMIUM_PATH')
        browser = await pw.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}), args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 1600, 'height': 1000}, device_scale_factor=1, accept_downloads=True)
        page.on('pageerror', lambda e: REPORT['errors'].append(str(e)))
        page.on('console', lambda m: REPORT['consoleErrors'].append(m.text) if m.type == 'error' else None)
        async def load():
            if FIXTURE:
                await page.set_content((ROOT / 'dist/Nexora-Diagram.html').read_text(), wait_until='load')
            else:
                await page.goto(os.getenv('NEXORA_URL', 'http://127.0.0.1:8080'), wait_until='networkidle')
            await page.wait_for_function('window.nexora && nexora.routing.routes.size === Object.keys(nexora.page.graph.edges).length')
            await page.wait_for_timeout(300)
            if FIXTURE:
                await page.evaluate('''() => { nexora.persistence = {save: async doc => {window.__savedDocument=structuredClone(doc)}}; document.getElementById('toast').hidden=true; }''')
        await load()
        await page.wait_for_function("[...nexora.routing.routes.values()].every(r=>r.status==='ok')")
        check('initial 9 connectors have obstacle-free routes', await page.evaluate("[...nexora.routing.routes.values()].filter(r=>r.status==='ok').length") == 9)
        check('router runs in a real Web Worker', await page.evaluate('!!nexora.routing.worker'))
        check('canvas display list contains editable scene content', await page.evaluate('nexora.renderer.scene.primitives.length') > 40)
        check('ribbon, stencils and inspector exist', await page.locator('[data-master="process"]').count() == 1 and await page.locator('[data-prop="w"]').count() == 1)
        await page.screenshot(path=str(OUT / 'desktop-preview.png'), full_page=True)

        async def world_point(x, y):
            return await page.evaluate('''([x,y]) => {const p=nexora.worldToScreen({x,y});const r=document.getElementById('stage').getBoundingClientRect();return {x:p.x+r.left,y:p.y+r.top};}''',[x,y])
        async def node_geometry(key='REQ01'):
            return await page.evaluate('''key=>{const n=Object.values(nexora.page.graph.nodes).find(n=>n.data.key===key);return {id:n.id,...nexora.page.view.nodes[n.id]};}''',key)
        async def drag_world(start, end):
            s=await world_point(*start);t=await world_point(*end)
            await page.mouse.move(s['x'],s['y']);await page.mouse.down();await page.mouse.move(t['x'],t['y'],steps=10);await page.mouse.up();await page.wait_for_timeout(180)

        original=await node_geometry();before_history=await page.evaluate('nexora.store.undoStack.length')
        await drag_world((original['x']+original['w']/2,original['y']+original['h']/2),(original['x']+original['w']/2+45,original['y']+original['h']/2+15))
        moved=await node_geometry()
        check('pointer drag changes document geometry', moved['x'] != original['x'] or moved['y'] != original['y'], moved)
        check('a whole drag creates one undo command', await page.evaluate('nexora.store.undoStack.length') == before_history+1)
        await page.keyboard.press('Control+z');await page.wait_for_timeout(100)
        after_undo=await node_geometry();check('keyboard undo restores geometry',after_undo['x']==original['x'] and after_undo['y']==original['y'])
        await page.keyboard.press('Control+Shift+z');await page.wait_for_timeout(100)
        check('keyboard redo reapplies drag', (await node_geometry())['x']==moved['x'])
        await page.keyboard.press('Control+z')

        # Inspector input -> geometry, then actual handle resizing.
        await page.locator('[data-prop="w"]').fill('200');await page.locator('[data-prop="w"]').press('Tab');await page.wait_for_timeout(100)
        check('inspector edits mutate width', (await node_geometry())['w']==200)
        current=await node_geometry();await drag_world((current['x']+current['w'],current['y']+current['h']),(current['x']+current['w']+20,current['y']+current['h']+10))
        resized=await node_geometry();check('corner handle resizes geometry', resized['w']>200)

        # In-place text editing and binding.
        current=await node_geometry();pt=await world_point(current['x']+current['w']/2,current['y']+current['h']/2)
        await page.mouse.dblclick(pt['x'],pt['y']);await page.locator('.node-label-editor').fill('Review {{owner}}');await page.locator('.node-label-editor').press('Control+Enter');await page.wait_for_timeout(80)
        check('double-click label editor commits real node text',await page.evaluate("Object.values(nexora.page.graph.nodes).find(n=>n.data.key==='REQ01').label")=='Review {{owner}}')
        check('data-bound label is resolved in the renderer',await page.evaluate("nexora.renderer.scene.texts.some(t=>t.lines.join(' ').includes('Review Requester'))"))

        # Format palette and clipboard.
        await page.locator('[data-fill="#e7f5ef"]').first.click();check('palette changes actual fill',(await node_geometry())['fill']=='#e7f5ef')
        await page.evaluate("document.getElementById('stage').focus()")
        n=await page.evaluate('Object.keys(nexora.page.graph.nodes).length');await page.keyboard.press('Control+d');await page.wait_for_timeout(100)
        check('duplicate creates a new semantic shape',await page.evaluate('Object.keys(nexora.page.graph.nodes).length')==n+1)
        await page.keyboard.press('Delete');await page.wait_for_timeout(50);check('delete removes the duplicated shape',await page.evaluate('Object.keys(nexora.page.graph.nodes).length')==n)
        await page.keyboard.press('Control+z');await page.wait_for_timeout(50);check('delete is undoable',await page.evaluate('Object.keys(nexora.page.graph.nodes).length')==n+1)
        await page.keyboard.press('Control+z') # undo duplicate

        # Custom programmable stencil via the real dialog.
        await page.locator('#custom-stencil-button').click();await page.locator('#dialog-footer button.primary').click();await page.wait_for_timeout(100)
        check('programmable stencil registers safely',await page.evaluate("!!nexora.doc.stencils.chevron"))
        await page.locator('[data-master="chevron"]').click();await page.wait_for_timeout(100)
        check('custom stencil instantiates a real shape',await page.evaluate("Object.values(nexora.page.graph.nodes).some(n=>n.master==='chevron')"))

        # Layer visibility and lock buttons.
        await page.locator('[data-inspector-tab="layers"]').click();await page.locator('[data-layer-visible="annotations"]').click()
        check('layer visibility is persisted in the model',await page.evaluate("nexora.page.layers.find(l=>l.id==='annotations').visible===false"))
        await page.locator('[data-layer-visible="annotations"]').click();await page.locator('[data-layer-lock="annotations"]').click()
        check('layer lock changes semantic editing rules',await page.evaluate("nexora.page.layers.find(l=>l.id==='annotations').locked"))
        await page.locator('[data-layer-lock="annotations"]').click()

        # CSV import through a real file input and mapping dialog.
        await page.locator('#csv-file').set_input_files({'name':'update.csv','mimeType':'text/csv','buffer':b'key,owner,status\nREQ01,Integration Tester,Approved\n'})
        await page.locator('#dialog-footer button.primary').click();await page.wait_for_timeout(100)
        check('CSV import updates matching shape data',await page.evaluate("Object.values(nexora.page.graph.nodes).find(n=>n.data.key==='REQ01').data.owner")=='Integration Tester')
        await page.wait_for_function("nexora.renderer.scene.texts.some(t=>t.lines.join(' ').includes('Integration'))")
        check('bound text updates after CSV', True)

        # Export operations return nonempty vector and semantic files.
        async with page.expect_download() as pending:
            await page.locator('#export-button').click()
        download=await pending.value;dest=OUT/'test-export.svg';await download.save_as(str(dest));svg=dest.read_text()
        check('SVG export contains vector paths and text', '<path' in svg and '<text' in svg and 'data-nexora-id' in svg)
        async with page.expect_download() as pending:
            await page.locator('#quick-actions [data-action="save-project"]').click()
        download=await pending.value;dest=OUT/'test-project.json';await download.save_as(str(dest));saved=json.loads(dest.read_text())
        check('project export contains semantic and visual models',saved['format']=='nexora.diagram' and all('graph' in p and 'view' in p for p in saved['pages'].values()))

        # Create a blank second page and connect two new editable shapes with the pointer.
        await page.locator('[data-action="add-page"]').click();await page.wait_for_timeout(100)
        check('add page creates independent graph',await page.evaluate('nexora.doc.pageOrder.length===2 && Object.keys(nexora.page.graph.nodes).length===0'))
        await page.evaluate("nexora.addShape('process',{x:280,y:300});nexora.addShape('process',{x:650,y:300})")
        ids=await page.evaluate('Object.keys(nexora.page.graph.nodes)');gs=await page.evaluate('Object.values(nexora.page.view.nodes)')
        await page.locator('[data-action="tool-connect"]').first.click()
        await drag_world((gs[0]['x']+gs[0]['w'],gs[0]['y']+gs[0]['h']/2),(gs[1]['x'],gs[1]['y']+gs[1]['h']/2))
        await page.wait_for_timeout(150)
        check('port dragging creates a semantic connector',await page.evaluate('Object.keys(nexora.page.graph.edges).length')==1)
        ep=await page.evaluate('Object.values(nexora.page.graph.edges)[0]');check('connector endpoints reference stable shape identities',ep['from']['nodeId']==ids[0] and ep['to']['nodeId']==ids[1])
        await page.locator('[data-action="tool-pointer"]').first.click()
        route=await page.evaluate('[...nexora.routing.routes.values()][0].points');index=max(0,len(route)//2-1);mid={'x':(route[index]['x']+route[index+1]['x'])/2,'y':(route[index]['y']+route[index+1]['y'])/2};pt=await world_point(mid['x'],mid['y']);await page.mouse.dblclick(pt['x'],pt['y']);await page.wait_for_timeout(100)
        check('connector double-click adds an editable waypoint',await page.evaluate('Object.values(nexora.page.view.edges)[0].waypoints.length')==1)

        # New-container membership is semantic and movement propagates to children.
        await page.evaluate('nexora.select(Object.keys(nexora.page.graph.nodes))');await page.locator('[data-ribbon-tab="Insert"]').click();await page.locator('[data-action="make-container"]').click();await page.wait_for_timeout(100)
        check('container stores parent-child relationships',await page.evaluate("Object.values(nexora.page.graph.nodes).filter(n=>n.parentId).length") == 2)
        container=await page.evaluate("()=>{let n=Object.values(nexora.page.graph.nodes).find(n=>n.master==='container');return {id:n.id,...nexora.page.view.nodes[n.id]}}")
        before=await page.evaluate('Object.values(nexora.page.view.nodes).map(g=>({x:g.x,y:g.y}))')
        await drag_world((container['x']+100,container['y']+20),(container['x']+140,container['y']+50))
        after=await page.evaluate('Object.values(nexora.page.view.nodes).map(g=>({x:g.x,y:g.y}))')
        dx=after[-1]['x']-before[-1]['x'];dy=after[-1]['y']-before[-1]['y']
        check('moving container moves all members by the same delta',all(abs(after[i]['x']-before[i]['x']-dx)<0.01 and abs(after[i]['y']-before[i]['y']-dy)<0.01 for i in range(3)),{'before':before,'after':after})

        # Validate and test multi-page persistence restoration through import.
        await page.evaluate('nexora.runValidation()');await page.wait_for_timeout(100)
        check('validation panel displays computed diagnostics',await page.locator('#validation-panel').is_visible())
        await page.locator('#project-file').set_input_files(OUT/'test-project.json');await page.wait_for_timeout(150)
        check('project import restores saved page graph',await page.evaluate('nexora.doc.pageOrder.length')==1)
        await page.evaluate('nexora.autosave()');await page.wait_for_timeout(100)
        if FIXTURE:
            check('autosave invokes injected persistence with a document snapshot',await page.evaluate("window.__savedDocument?.format==='nexora.diagram'"))
        else:
            title=await page.evaluate('nexora.doc.title');await page.reload(wait_until='networkidle');await page.wait_for_function('window.nexora');check('IndexedDB project survives reload',await page.evaluate('nexora.doc.title')==title)

        # Mobile layout and the explicit renderer badge.
        await page.set_viewport_size({'width':390,'height':844});await page.wait_for_timeout(150)
        await page.evaluate('nexora.fitPage()');await page.wait_for_timeout(100)
        check('mobile canvas retains positive drawable dimensions',await page.evaluate('nexora.camera.width>180 && nexora.camera.height>300'))
        await page.evaluate("document.getElementById('toast').hidden=true;document.getElementById('validation-panel').hidden=true")
        await page.screenshot(path=str(OUT/'mobile-preview.png'),full_page=True)
        REPORT['backend']=await page.evaluate('nexora.renderer.mode');REPORT['webgpuBrowserTested']=REPORT['backend']=='WebGPU'
        check('no uncaught application errors',not REPORT['errors'],REPORT['errors'])
        check('no browser console errors',not REPORT['consoleErrors'],REPORT['consoleErrors'])
        await browser.close()

if __name__=='__main__':
    try:
        asyncio.run(main())
    finally:
        (OUT/'browser-test-results.json').write_text(json.dumps(REPORT,indent=2))
        print(json.dumps(REPORT,indent=2))
