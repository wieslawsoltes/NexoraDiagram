import { WebGPURenderer } from '../src/render/webgpu.js';
import { buildScene } from '../src/render/scene.js';
import { createDemo } from '../src/core/template.js';
import { RoutingService } from '../src/core/routing-service.js';
const output=document.getElementById('result'),errors=[];
let device,renderer,routing;
try {
  if(!navigator.gpu) throw new Error('WebGPU is not available in this browser/context. Use a supporting browser on localhost or HTTPS.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter) throw new Error('No compatible GPU adapter is available.');
  device=await adapter.requestDevice();device.addEventListener('uncapturederror',event=>{event.preventDefault();errors.push(event.error.message);output.textContent=JSON.stringify({status:'FAIL',errors},null,2);});
  device.pushErrorScope('validation');
  renderer=new WebGPURenderer(document.getElementById('test'),device);await renderer.initialize();
  const doc=createDemo(),page=doc.pages[doc.pageOrder[0]];routing=new RoutingService();await routing.flush(doc,page);
  const camera={width:900,height:650,dpr:Math.min(2,devicePixelRatio||1),zoom:.65,x:20,y:20};
  renderer.setScene(buildScene(doc,page,routing.routes),camera);renderer.draw(camera,page,true);
  await device.queue.onSubmittedWorkDone();
  const validation=await device.popErrorScope();if(validation)throw new Error(validation.message);
  if(errors.length)throw new Error(errors.join('\n'));
  output.textContent=JSON.stringify({status:'PASS — shaders compiled and commands completed',secureContext:isSecureContext,adapter:adapter.info?.description||adapter.info?.device||'Not exposed',routes:routing.routes.size,...renderer.lastStats,limitations:'No pixel-golden comparison; no throughput benchmark.'},null,2);
} catch(error) {output.textContent=JSON.stringify({status:'NOT PASSED',message:error.message,secureContext:isSecureContext},null,2);}
window.addEventListener('pagehide',()=>{routing?.dispose();renderer?.dispose();if(!renderer)device?.destroy();});
