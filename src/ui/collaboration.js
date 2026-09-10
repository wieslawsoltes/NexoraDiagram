import { CollaborationDocument, collaborationKeyForPath } from '../core/collaboration.js';
import { assertDocument } from '../core/model.js';
import { applyPatches } from '../core/history.js';
import { esc } from './icons.js';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),limit=50*1024*1024;
export function invitationId(){return [...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');}
const peerId=()=>`peer_${invitationId()}`;
/** Capability-based peer session: no account, telemetry or external relay. A copied WebRTC
 * offer/answer is an invitation to edit. Only explicitly configured ICE servers are contacted.
 */
export class CollaborationSession {
  constructor(app,{room,name='Editor',join=false,iceServers=[]}={}){
    if(!/^[a-zA-Z0-9_-]{8,96}$/.test(room||''))throw new Error('Room IDs require 8–96 letters, digits, underscores or hyphens.');
    this.app=app;this.peer=peerId();this.room=room;this.name=name.trim().slice(0,60)||'Editor';this.joining=join;this.ready=!join;this.iceServers=iceServers;this.engine=new CollaborationDocument(app.doc,this.peer);this.queue=[];this.peers=new Map();this.connections=new Set();this.channels=new Set();this.assemblies=new Map();this.sent=new Set();this.disposed=false;
    this.listener=e=>this.changed(e.detail);app.store.addEventListener('change',this.listener);
    this.oldReadOnly=app.store.readOnlyReason;if(join)app.store.readOnlyReason='Waiting for the host document. Disconnect to resume local editing.';this.oldApply=app.store.historyApply;app.store.historyApply=(command,forward)=>this.historyApply(command,forward);
    try{this.broadcast=new BroadcastChannel(`nexora-sync-${room}`);this.broadcast.onmessage=e=>this.receive(e.data,'broadcast');}catch{this.broadcast=null;}
    this.heartbeat=setInterval(()=>{this.send({type:'presence',name:this.name,pageId:app.pageId});const now=Date.now();for(const [id,p]of this.peers)if(now-p.seen>15000)this.peers.delete(id);for(const [id,p]of this.assemblies)if(now-p.created>60000)this.assemblies.delete(id);app.requestFrame();},5000);
    this.pointer=e=>{if(Date.now()-(this.lastPointer||0)<65)return;this.lastPointer=Date.now();const p=app.screenToWorld(app.pointerPosition(e));this.send({type:'presence',name:this.name,pageId:app.pageId,point:p});};document.getElementById('stage').addEventListener('pointermove',this.pointer);
    this.send({type:'hello',joining:join,name:this.name,documentId:app.doc.id});
  }
  envelope(body){return {transport:'nexora.peer.v1',room:this.room,sender:this.peer,id:`${this.peer}-${invitationId()}`,body};}
  send(body,except=null){if(this.disposed)return;this.relay(this.envelope(body),except);}
  relay(envelope,except=null){
    if(this.sent.has(envelope.id))return;this.sent.add(envelope.id);while(this.sent.size>4096)this.sent.delete(this.sent.values().next().value);
    const data=JSON.stringify(envelope);if(data.length>limit)throw new Error('Session message exceeds the 50 MB limit.');
    if(except!=='broadcast')this.broadcast?.postMessage(envelope);
    for(const ch of this.channels)if(ch!==except&&ch.readyState==='open')this.sendChannel(ch,data).catch(error=>this.error(error));
  }
  async sendChannel(channel,text){
    // UTF-8 byte-safe framing; avoids SCTP max-message-size and string splitting hazards.
    const bytes=new TextEncoder().encode(text),id=invitationId(),size=12000,total=Math.ceil(bytes.length/size);
    for(let index=0;index<total;index++){
      const deadline=Date.now()+30000;while(channel.bufferedAmount>262144){if(channel.readyState!=='open')throw new Error('Peer disconnected while sending.');if(Date.now()>deadline)throw new Error('Peer send buffer timed out.');await new Promise(r=>setTimeout(r,20));}
      if(channel.readyState!=='open')throw new Error('Peer disconnected while sending.');const chunk=bytes.subarray(index*size,(index+1)*size);channel.send(JSON.stringify({frame:'nexora.chunk.v1',id,index,total,data:btoa(String.fromCharCode(...chunk))}));
    }
  }
  channelMessage(raw,channel){
    if(typeof raw!=='string'||raw.length>24000)throw new Error('Invalid peer frame.');const part=JSON.parse(raw);
    if(part.frame!=='nexora.chunk.v1'||typeof part.id!=='string'||part.id.length>64||!Number.isInteger(part.index)||!Number.isInteger(part.total)||part.total<1||part.total>4500||part.index<0||part.index>=part.total||typeof part.data!=='string'||part.data.length>16000)throw new Error('Invalid peer frame.');
    const id=`${channel._nexoraId}:${part.id}`;let entry=this.assemblies.get(id);if(!entry){if(this.assemblies.size>=16)throw new Error('Too many incomplete peer messages.');entry={created:Date.now(),total:part.total,parts:new Map(),size:0};this.assemblies.set(id,entry);}
    if(entry.total!==part.total)throw new Error('Mismatched peer frame count.');if(!entry.parts.has(part.index)){const decoded=atob(part.data),bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));entry.parts.set(part.index,bytes);entry.size+=bytes.length;if([...this.assemblies.values()].reduce((sum,p)=>sum+p.size,0)>limit){this.assemblies.delete(id);throw new Error('Peer message exceeds the limit.');}}
    if(entry.parts.size===entry.total){this.assemblies.delete(id);const bytes=new Uint8Array(entry.size);let at=0;for(let i=0;i<entry.total;i++){const p=entry.parts.get(i);bytes.set(p,at);at+=p.length;}this.receive(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),channel);}
  }
  receive(envelope,source){
    try{
      if(!envelope||envelope.transport!=='nexora.peer.v1'||envelope.room!==this.room||envelope.sender===this.peer||typeof envelope.id!=='string'||envelope.id.length>200||!/^peer_[\w-]+$/.test(envelope.sender)||this.sent.has(envelope.id))return;
      const body=envelope.body;if(!body||typeof body!=='object')return;const p=this.peers.get(envelope.sender)||{};p.seen=Date.now();p.name=String(body.name||p.name||'Editor').slice(0,60);this.peers.set(envelope.sender,p);
      if(body.type==='hello'){
        if(this.ready&&body.joining)this.send({type:'state',target:envelope.sender,state:this.engine.snapshot(),documentId:this.engine.last.id,name:this.name});
        else if(this.ready&&!body.joining&&body.documentId===this.engine.last.id)this.send({type:'state',target:envelope.sender,state:this.engine.snapshot(),documentId:this.engine.last.id,name:this.name});
      }else if(body.type==='state'||body.type==='operation'){
        if(body.target&&body.target!==this.peer){this.relay(envelope,source);return;}
        if(!this.ready&&body.type!=='state')return;
        if(this.ready&&body.documentId!==this.engine.last.id)throw new Error('Another document is using this room. Join explicitly or choose a new room.');
        if(this.app.store.pending){if(this.queue.length>=1000){this.close();throw new Error('Receive queue exceeded its safety limit. Reconnect after completing the active gesture.');}this.queue.push({envelope,source});return;}
        if(!this.ready){this.engine.records=new Map();const result=this.engine.apply(body.state);this.ready=true;this.joining=false;this.app.store.readOnlyReason=this.oldReadOnly;this.app.store.undoStack=[];this.app.store.redoStack=[];this.app.store.bytes=0;this.install(result.doc);this.send({type:'hello',joining:false,name:this.name,documentId:result.doc.id});}
        else{const result=this.engine.apply(body.type==='state'?body.state:body.operation);if(result.changed)this.install(result.doc);}
      }else if(body.type==='presence'){
        p.pageId=String(body.pageId||'');if(body.point&&Number.isFinite(body.point.x)&&Number.isFinite(body.point.y)&&Math.max(Math.abs(body.point.x),Math.abs(body.point.y))<=1e6)p.point=body.point;
      }else if(body.type==='leave'){this.peers.delete(envelope.sender);}
      this.relay(envelope,source);this.app.requestFrame();
    }catch(error){this.error(error);}
  }
  install(doc){assertDocument(doc);const store=this.app.store;store.doc=doc;store.revision++;store.notify('remote','Peer edit');}
  changed(detail){
    if(this.disposed||detail.kind==='preview'||detail.kind==='remote')return;
    if(detail.kind==='load'){this.error(new Error('Collaboration stopped because a different project was opened.'));this.close();return;}
    if(this.ready&&['commit','undo','redo'].includes(detail.kind)){
      try{const operation=this.engine.local(this.app.doc);if(operation){const stack=detail.kind==='undo'?this.app.store.redoStack:this.app.store.undoStack,c=stack.at(-1);if(c){c.collaborationStamps={};for(const patch of c.patches){const [entity,field]=collaborationKeyForPath(patch.path);c.collaborationStamps[JSON.stringify([entity,field])]=this.engine.stamp(entity,field);}}
        this.send({type:'operation',documentId:this.engine.last.id,operation,name:this.name});}}
      catch(error){this.error(error);}
    }
    if(!this.app.store.pending&&this.queue.length){const queued=this.queue.splice(0);for(const item of queued)this.receive(item.envelope,item.source);}
  }
  historyApply(command,forward){
    const accepted=command.patches.filter(p=>{const [entity,field]=collaborationKeyForPath(p.path),stamp=command.collaborationStamps?.[JSON.stringify([entity,field])];if(!stamp||!equal(stamp,this.engine.stamp(entity,field)))return false;let value=this.app.doc;for(const k of p.path)value=value?.[k];return equal(value,forward?p.before:p.after);});
    const doc=structuredClone(this.app.doc);try{applyPatches(doc,accepted,forward);assertDocument(doc);}catch{this.app.ui.showToast('Undo was skipped because a peer changed related document structure.');return [];}
    if(accepted.length!==command.patches.length)this.app.ui.showToast('Undo preserved properties changed by another editor.');this.app.store.doc=doc;return accepted;
  }
  attachChannel(channel){
    channel._nexoraId=invitationId();this.channels.add(channel);channel.onmessage=e=>{try{this.channelMessage(e.data,channel);}catch(error){this.error(error);}};
    channel.onopen=()=>this.send({type:'hello',joining:!this.ready,name:this.name,documentId:this.engine.last.id});channel.onclose=()=>this.channels.delete(channel);channel.onerror=()=>this.error(new Error('Peer data channel failed.'));
  }
  connection(){const pc=new RTCPeerConnection({iceServers:this.iceServers});this.connections.add(pc);pc.ondatachannel=e=>this.attachChannel(e.channel);pc.onconnectionstatechange=()=>{if(['failed','disconnected'].includes(pc.connectionState))this.app.ui.showToast('Peer disconnected. Local edits remain available; exchange a new invitation to reconnect.');};return pc;}
  async gather(pc){if(pc.iceGatheringState==='complete')return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',done);reject(new Error('Network candidate collection timed out. Check ICE configuration.'));},20000);const done=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',done);resolve();}};pc.addEventListener('icegatheringstatechange',done);});}
  async createOffer(){const pc=this.connection();this.pendingOffer=pc;this.attachChannel(pc.createDataChannel('nexora-edits',{ordered:true}));await pc.setLocalDescription(await pc.createOffer());await this.gather(pc);return JSON.stringify({protocol:'nexora.invite.v1',room:this.room,description:pc.localDescription});}
  parseSignal(text,type){if(text.length>100000)throw new Error('Invitation is too large.');const signal=JSON.parse(text);if(signal.protocol!=='nexora.invite.v1'||signal.room!==this.room||signal.description?.type!==type||typeof signal.description.sdp!=='string')throw new Error('Invitation does not match this room or step.');return signal.description;}
  async answerOffer(text){const description=this.parseSignal(text,'offer'),pc=this.connection();await pc.setRemoteDescription(description);await pc.setLocalDescription(await pc.createAnswer());await this.gather(pc);return JSON.stringify({protocol:'nexora.invite.v1',room:this.room,description:pc.localDescription});}
  async acceptAnswer(text){if(!this.pendingOffer)throw new Error('Create an offer first.');await this.pendingOffer.setRemoteDescription(this.parseSignal(text,'answer'));this.pendingOffer=null;}
  overlay(){return [...this.peers.values()].filter(p=>p.point&&p.pageId===this.app.pageId&&Date.now()-p.seen<15000).map(p=>{const q=this.app.worldToScreen(p.point);return `<g pointer-events="none" transform="translate(${q.x} ${q.y})"><path d="M0 0L3 16L7 11L14 10Z" fill="#087e8b" stroke="white"/><rect x="12" y="12" width="${Math.max(40,p.name.length*7+12)}" height="21" rx="4" fill="#087e8b"/><text x="18" y="27" fill="white" font-family="sans-serif" font-size="12">${esc(p.name)}</text></g>`;}).join('');}
  error(error){this.lastError=error.message;this.app.ui.showToast(`Collaboration: ${error.message}`,true);}
  close(){if(this.disposed)return;this.send({type:'leave'});this.disposed=true;clearInterval(this.heartbeat);this.broadcast?.close();for(const pc of this.connections)pc.close();this.channels.clear();this.assemblies.clear();this.app.store.removeEventListener('change',this.listener);this.app.store.historyApply=this.oldApply;this.app.store.readOnlyReason=this.oldReadOnly;document.getElementById('stage').removeEventListener('pointermove',this.pointer);this.peers.clear();this.app.requestFrame();if(this.app.collaboration===this)this.app.collaboration=null;}
}
