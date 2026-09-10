/** Bounded ZIP/DEFLATE codec for browser-local document packages. ZIP64/encryption are rejected. */
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function safeName(name){if(typeof name!=='string'||name.length>512||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>p==='..'||p==='.'||p.includes('\0'))||/^[a-z]:/i.test(name))throw new Error('Unsafe archive path.');return name;}
const LB=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LE=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DB=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DE=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
function huffman(lengths){const counts=Array(16).fill(0),next=Array(16).fill(0),table=new Map();for(const n of lengths){if(n<0||n>15)throw new Error('Invalid Huffman length.');counts[n]++;}let code=0;counts[0]=0;for(let bits=1;bits<=15;bits++){code=(code+counts[bits-1])<<1;next[bits]=code;if(code+counts[bits]>(1<<bits))throw new Error('Oversubscribed Huffman tree.');}lengths.forEach((bits,symbol)=>{if(!bits)return;let c=next[bits]++,reversed=0;for(let i=0;i<bits;i++){reversed=(reversed<<1)|(c&1);c>>>=1;}table.set(`${bits}:${reversed}`,symbol);});return table;}
export function inflateRaw(input,size,maxBytes=50*1024*1024){
  if(!Number.isInteger(size)||size<0||size>maxBytes)throw new Error('Inflated data exceeds the package limit.');
  const out=new Uint8Array(size);let bit=0,at=0,final=false;
  const read=n=>{if(bit+n>input.length*8)throw new Error('Truncated deflate stream.');let value=0;for(let i=0;i<n;i++,bit++)value|=((input[bit>>3]>>(bit&7))&1)<<i;return value;};
  const symbol=tree=>{let value=0;for(let length=1;length<=15;length++){value|=read(1)<<(length-1);const s=tree.get(`${length}:${value}`);if(s!==undefined)return s;}throw new Error('Invalid deflate symbol.');};
  const write=value=>{if(at>=size)throw new Error('Deflate output exceeds its declared size.');out[at++]=value;};
  let blocks=0;
  while(!final){if(++blocks>1000000)throw new Error('Too many deflate blocks.');final=!!read(1);const type=read(2);
    if(type===0){bit=(bit+7)&~7;const length=read(16),inverse=read(16);if((length^0xffff)!==inverse)throw new Error('Invalid stored block length.');for(let i=0;i<length;i++)write(read(8));continue;}
    if(type===3)throw new Error('Reserved deflate block type.');let lit,dist;
    if(type===1){lit=huffman(Array.from({length:288},(_,i)=>i<144?8:i<256?9:i<280?7:8));dist=huffman(Array(32).fill(5));}
    else{const nl=read(5)+257,nd=read(5)+1,nc=read(4)+4,order=[16,17,18,0,8,7,9,6,10,5,11,4,10,5];
      const actualOrder=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],cl=Array(19).fill(0);for(let i=0;i<nc;i++)cl[actualOrder[i]]=read(3);const tree=huffman(cl),lengths=[];
      while(lengths.length<nl+nd){const s=symbol(tree);if(s<16)lengths.push(s);else{if(s===16&&!lengths.length)throw new Error('Invalid code-length repeat.');const length=s===16?read(2)+3:s===17?read(3)+3:read(7)+11,value=s===16?lengths.at(-1):0;if(lengths.length+length>nl+nd)throw new Error('Too many code lengths.');for(let i=0;i<length;i++)lengths.push(value);}}
      if(!lengths[256])throw new Error('Missing deflate end symbol.');lit=huffman(lengths.slice(0,nl));dist=huffman(lengths.slice(nl));
    }
    while(true){const s=symbol(lit);if(s<256){write(s);continue;}if(s===256)break;if(s<257||s>285)throw new Error('Invalid deflate length.');const length=LB[s-257]+read(LE[s-257]),d=symbol(dist);if(d>29)throw new Error('Invalid deflate distance.');const offset=DB[d]+read(DE[d]);if(offset>at)throw new Error('Deflate backreference precedes output.');for(let i=0;i<length;i++)write(out[at-offset]);}
  }
  if(at!==size)throw new Error('Deflate output size mismatch.');return out;
}
export function readZIP(bytes,{maxBytes=50*1024*1024,maxEntries=2000}={}){
  if(!(bytes instanceof Uint8Array))bytes=new Uint8Array(bytes);if(bytes.length>maxBytes||bytes.length<22)throw new Error('Invalid package size.');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=at=>{if(at<0||at+2>bytes.length)throw new Error('Truncated ZIP.');return view.getUint16(at,true);},u32=at=>{if(at<0||at+4>bytes.length)throw new Error('Truncated ZIP.');return view.getUint32(at,true);};
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){end=i;break;}
  if(end<0||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))throw new Error('Unsupported split or corrupt ZIP package.');const count=u16(end+10),directorySize=u32(end+12),directoryStart=u32(end+16);if(count>maxEntries||count===65535||directoryStart+directorySize>end)throw new Error('ZIP directory exceeds limits.');
  const entries=new Map();let at=directoryStart,total=0;
  for(let i=0;i<count;i++){
    if(u32(at)!==0x02014b50)throw new Error('Invalid ZIP directory entry.');const flags=u16(at+8),method=u16(at+10),checksum=u32(at+16),packed=u32(at+20),size=u32(at+24),nameLength=u16(at+28),extra=u16(at+30),comment=u16(at+32),offset=u32(at+42);
    if(flags&1||![0,8].includes(method)||size===0xffffffff||packed===0xffffffff||offset===0xffffffff)throw new Error('Encrypted, ZIP64 or unsupported compression is not supported.');
    if(at+46+nameLength+extra+comment>directoryStart+directorySize)throw new Error('Truncated ZIP directory.');
    const name=safeName(decoder.decode(bytes.subarray(at+46,at+46+nameLength)));if(entries.has(name))throw new Error('Duplicate ZIP entry.');total+=size;if(total>maxBytes)throw new Error('Expanded package exceeds 50 MB.');
    if(u32(offset)!==0x04034b50||u16(offset+8)!==method||u16(offset+6)&1)throw new Error('Invalid ZIP local header.');const start=offset+30+u16(offset+26)+u16(offset+28);
    const localName=decoder.decode(bytes.subarray(offset+30,offset+30+u16(offset+26)));if(localName!==name||start+packed>directoryStart)throw new Error('ZIP entry range/name mismatch.');
    const raw=bytes.subarray(start,start+packed),content=method===0?raw.slice():inflateRaw(raw,size,maxBytes);if(content.length!==size||crc32(content)!==checksum)throw new Error('ZIP entry checksum or size mismatch.');entries.set(name,content);at+=46+nameLength+extra+comment;
  }
  if(at!==directoryStart+directorySize)throw new Error('ZIP directory size mismatch.');return entries;
}
export function writeZIP(entries){
  const files=[...entries].map(([name,value])=>({name:encoder.encode(safeName(name)),data:typeof value==='string'?encoder.encode(value):new Uint8Array(value)}));
  if(files.length>2000)throw new Error('Too many ZIP entries.');const length=files.reduce((sum,f)=>sum+76+f.name.length*2+f.data.length,22);if(length>50*1024*1024)throw new Error('Package exceeds 50 MB.');
  const out=new Uint8Array(length),view=new DataView(out.buffer),records=[];let at=0;
  const w16=(p,v)=>view.setUint16(p,v,true),w32=(p,v)=>view.setUint32(p,v,true);
  for(const f of files){const offset=at,checksum=crc32(f.data);w32(at,0x04034b50);w16(at+4,20);w16(at+6,0x800);w16(at+12,33);w32(at+14,checksum);w32(at+18,f.data.length);w32(at+22,f.data.length);w16(at+26,f.name.length);out.set(f.name,at+30);out.set(f.data,at+30+f.name.length);at+=30+f.name.length+f.data.length;records.push({...f,offset,checksum});}
  const start=at;for(const f of records){w32(at,0x02014b50);w16(at+4,20);w16(at+6,20);w16(at+8,0x800);w16(at+14,33);w32(at+16,f.checksum);w32(at+20,f.data.length);w32(at+24,f.data.length);w16(at+28,f.name.length);w32(at+42,f.offset);out.set(f.name,at+46);at+=46+f.name.length;}
  w32(at,0x06054b50);w16(at+8,files.length);w16(at+10,files.length);w32(at+12,at-start);w32(at+16,start);return out;
}
export const archiveText=bytes=>decoder.decode(bytes);
