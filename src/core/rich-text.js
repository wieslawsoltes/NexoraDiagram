/** Structured text runs. No stored executable HTML; each paragraph and mark is validated. */
export const TEXT_FONTS = ['sans-serif', 'serif', 'monospace'];
const COLOR = /^(#[\da-f]{6}|transparent)$/i;
export function plainText(rich) { return rich.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n'); }
export function validateRichText(rich) {
  if (!rich || rich.version !== 1 || !Array.isArray(rich.paragraphs) || rich.paragraphs.length < 1 || rich.paragraphs.length > 200) throw new Error('Invalid structured text.');
  let count = 0, total = 0;
  for (const p of rich.paragraphs) {
    if (!p || !['left', 'center', 'right', 'justify'].includes(p.align || 'left') || !['none', 'bullet', 'number'].includes(p.list || 'none') || !Array.isArray(p.runs) || !p.runs.length) throw new Error('Invalid text paragraph.');
    if (p.indent !== undefined && (!Number.isFinite(p.indent) || p.indent < 0 || p.indent > 8)) throw new Error('Invalid paragraph indentation.');
    for (const r of p.runs) {
      if (!r || typeof r.text !== 'string') throw new Error('Invalid text run.'); total += r.text.length; count++;
      for (const key of ['bold', 'italic', 'underline', 'strike']) if (r[key] !== undefined && typeof r[key] !== 'boolean') throw new Error('Invalid text mark.');
      if (r.size !== undefined && (!Number.isFinite(r.size) || r.size < 6 || r.size > 120)) throw new Error('Text size must be 6–120 pixels.');
      if (r.font !== undefined && !TEXT_FONTS.includes(r.font)) throw new Error('Unsupported text font family.');
      if (r.color !== undefined && !COLOR.test(r.color)) throw new Error('Invalid text color.');
      if (r.link !== undefined && (typeof r.link !== 'string' || r.link.length > 2048 || !/^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(r.link))) throw new Error('Only HTTP(S) and mailto links are supported.');
      if (r.script !== undefined && !['normal', 'sub', 'super'].includes(r.script)) throw new Error('Invalid text baseline.');
    }
  }
  if (count > 4096 || total > 10000) throw new Error('Structured text exceeds the document text limit.');
  return rich;
}
export function richFromPlain(text, align = 'left') { return { version: 1, paragraphs: String(text).split('\n').map(text => ({ align, runs: [{ text }] })) }; }
export function textFont(run, defaultSize = 16) { return `${run.italic ? 'italic ' : ''}${run.bold ? 700 : 400} ${(run.size || defaultSize) * (run.script && run.script !== 'normal' ? .72 : 1)}px ${run.font || 'sans-serif'}`; }
/** Line breaking on complete Unicode codepoints, with run-aware metrics and paragraph alignment. */
export function layoutRichText(rich, box, defaultSize = 16, measure = (text, run) => [...text].length * (run.size || defaultSize) * .55) {
  validateRichText(rich); const labels = []; let y = box.y, ordinal = 0;
  for (const paragraph of rich.paragraphs) {
    const indent = (paragraph.indent || 0) * defaultSize, bullet = paragraph.list === 'bullet' ? '• ' : paragraph.list === 'number' ? `${++ordinal}. ` : '';
    if (paragraph.list !== 'number') ordinal = 0;
    const available = Math.max(1, box.w - indent - (bullet ? defaultSize * 1.5 : 0)), left = box.x + indent + (bullet ? defaultSize * 1.5 : 0), lines = [];
    let line = [], width = 0, height = defaultSize * 1.3;
    const flush = () => { lines.push({ runs: line, width, height }); line = []; width = 0; height = defaultSize * 1.3; };
    for (const run of paragraph.runs) {
      for (const word of run.text.match(/\n|[^\S\n]+|[^\s]+/gu) || ['']) {
        if (word === '\n') { flush(); continue; }
        let w = measure(word, run);
        if (width && width + w > available && !/^\s+$/.test(word)) flush();
        if (w > available) {
          for (const char of [...word]) { const cw = measure(char, run); if (width && width + cw > available) flush(); line.push({ ...run, text: char, width: cw }); width += cw; height = Math.max(height, (run.size || defaultSize) * 1.3); }
        } else { line.push({ ...run, text: word, width: w }); width += w; height = Math.max(height, (run.size || defaultSize) * 1.3); }
      }
    }
    flush();
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li], align = paragraph.align || 'left';
      let x = left + (align === 'center' ? (available - l.width) / 2 : align === 'right' ? available - l.width : 0);
      const gaps = l.runs.filter(r => /^\s+$/.test(r.text)).length, justify = align === 'justify' && li < lines.length - 1 && gaps ? Math.max(0, available - l.width) / gaps : 0;
      if (li === 0 && bullet) labels.push({ text: bullet, x: box.x + indent, y, size: defaultSize, width: defaultSize * 1.5 });
      for (const run of l.runs) { const size = run.size || defaultSize; labels.push({ ...run, x, y: y + (l.height - size * 1.3) + (run.script === 'sub' ? size * .3 : run.script === 'super' ? -size * .2 : 0), size: size * (run.script && run.script !== 'normal' ? .72 : 1) }); x += run.width + (/^\s+$/.test(run.text) ? justify : 0); }
      y += l.height;
    }
    y += defaultSize * .25;
  }
  return { runs: labels, height: Math.max(defaultSize * 1.3, y - box.y - defaultSize * .25) };
}
