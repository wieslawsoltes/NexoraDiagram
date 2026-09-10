/** Deterministic tiled print plan in document pixels (96 px per physical inch). */
import { exportSVG, exportScene } from './export-svg.js';
export const PRINT_PAPERS = { A4:[210,297], A3:[297,420], Letter:[215.9,279.4], Legal:[215.9,355.6], Tabloid:[279.4,431.8] };
export function planTiles(box, { paper='A4', landscape=false, margin=10, overlap=5, scale=1, fit=false }={}) {
  if (!PRINT_PAPERS[paper]) throw new Error('Unknown print paper.');
  if (![box.x,box.y,box.w,box.h,margin,overlap,scale].every(Number.isFinite) || box.w<=0 || box.h<=0 || margin<0 || overlap<0 || scale<=0 || scale>100) throw new Error('Invalid print dimensions or scale.');
  let [width,height]=PRINT_PAPERS[paper]; if(landscape) [width,height]=[height,width]; const pw=width-2*margin,ph=height-2*margin;
  if(pw<20 || ph<20 || overlap>=Math.min(pw,ph)/2) throw new Error('Margins or overlap leave too little printable area.');
  if(fit) scale=Math.min(pw*96/25.4/box.w,ph*96/25.4/box.h);
  const tw=pw*96/25.4/scale,th=ph*96/25.4/scale,stepX=(pw-overlap)*96/25.4/scale,stepY=(ph-overlap)*96/25.4/scale;
  const columns=fit?1:Math.max(1,Math.ceil((box.w-tw)/stepX-1e-9)+1), rows=fit?1:Math.max(1,Math.ceil((box.h-th)/stepY-1e-9)+1);
  if(columns*rows>400) throw new Error('Print exceeds 400 sheets. Reduce scale or choose a larger paper.');
  const tiles=[]; for(let row=0;row<rows;row++) for(let column=0;column<columns;column++) tiles.push({row,column,x:box.x+column*stepX,y:box.y+row*stepY,w:tw,h:th});
  return {paper,width,height,margin,overlap,scale,columns,rows,tiles};
}
const escape=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
export function tiledPrintHTML(doc, pages, routesByPage, options={}) {
  const sheets=[]; let format;
  for(const page of pages) {
    const routes=routesByPage.get(page.id)||new Map(), {box}=exportScene(doc,page,routes),plan=planTiles(box,options); format=plan;
    const vector=exportSVG(doc,page,routes).replace(/<\?xml[^>]*\?>/,'');
    for(const tile of plan.tiles) { const svg=vector.replace(/viewBox="[^"]*"/,`viewBox="${tile.x} ${tile.y} ${tile.w} ${tile.h}"`).replace(/(<svg[^>]*?)width="[^"]*" height="[^"]*"/,`$1width="100%" height="100%"`);
      sheets.push(`<section class="sheet">${svg}${options.marks===false?'':`<div class="registration top"></div><div class="registration bottom"></div><div class="sheet-label">${escape(page.name)} · row ${tile.row+1}/${plan.rows}, column ${tile.column+1}/${plan.columns} · ${+(plan.scale*100).toFixed(2)}%</div>`}</section>`);
    }
  }
  if(!format || sheets.length>400) throw new Error('Select 1–400 printable sheets.');
  const {width,height,margin}=format;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(doc.title)} — print</title><style>@page{size:${width}mm ${height}mm;margin:${margin}mm}*{box-sizing:border-box}body{margin:0;background:#ddd}.sheet{width:${width-2*margin}mm;height:${height-2*margin}mm;background:white;position:relative;overflow:hidden;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}.sheet>svg{display:block;width:100%;height:100%}.sheet-label{position:absolute;bottom:1mm;left:3mm;font:8px sans-serif;color:#444;background:#fffd;padding:1mm}.registration{position:absolute;left:0;right:0;height:4mm;border-left:1px solid black;border-right:1px solid black;pointer-events:none}.top{top:0;border-top:1px solid black}.bottom{bottom:0;border-bottom:1px solid black}@media screen{.sheet{margin:8mm auto;box-shadow:0 2px 8px #888}}</style></head><body>${sheets.join('\n')}</body></html>`;
}
