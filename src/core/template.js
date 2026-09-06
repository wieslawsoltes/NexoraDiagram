import { createDocument, addNode, addEdge } from './model.js';
export function createDemo() {
  const doc = createDocument('Purchase approval workflow'); const page = doc.pages[doc.pageOrder[0]]; page.name = 'Approval flow';
  const put = (master, x, y, label, geometry = {}, data = {}, parentId = null) => addNode(doc, page, master, x, y, { label, geometry, data, parentId });
  put('text', 66, 48, 'Purchase approval workflow', { w: 950, h: 52, fontSize: 32, textColor: '#23364d', weight: 600 });
  put('text', 68, 106, 'PROCUREMENT  /  STANDARD OPERATING PROCEDURE', { w: 950, h: 28, fontSize: 12, textColor: '#8d9aaa' });
  put('text', 1100, 62, 'v1.0 · DRAFT', { w: 154, h: 30, fontSize: 12, textColor: '#807199', align: 'right' });
  const requester = put('swimlane', 65, 173, '01    REQUESTER', { w: 1190, h: 192, fill: '#fcfdff', headerFill: '#f0f4fa', textColor: '#5e7089' });
  const operations = put('swimlane', 65, 373, '02    OPERATIONS', { w: 1190, h: 192, fill: '#fcfffe', headerFill: '#edf5f2', textColor: '#62877a' });
  const finance = put('swimlane', 65, 573, '03    FINANCE', { w: 1190, h: 192, fill: '#fdfcff', headerFill: '#f3eff8', textColor: '#877298' });
  const start = put('terminator', 108, 259, 'Request\nsubmitted', { w: 132, h: 54 }, { key: 'START', status: 'Active' }, requester);
  const request = put('process', 307, 245, 'Create purchase\nrequest', { w: 178, h: 80 }, { key: 'REQ01', owner: 'Requester', status: 'Ready', sla: '1 day' }, requester);
  const complete = put('decision', 566, 238, 'Details\ncomplete?', { w: 138, h: 94 }, { key: 'CHECK', owner: 'Requester' }, requester);
  const update = put('process', 848, 245, 'Add missing\ninformation', { w: 185, h: 80, fill: '#f5f1fc', stroke: '#b0a0ce', textColor: '#6b5687' }, { key: 'UPDATE', owner: 'Requester' }, requester);
  const review = put('process', 551, 440, 'Review request', { w: 170, h: 78, fill: '#eaf6f1', stroke: '#85b6a4', textColor: '#3b7662' }, { key: 'OPS01', owner: 'Operations', status: 'Pending', sla: '2 days' }, operations);
  const budget = put('decision', 844, 431, 'Within\nbudget?', { w: 138, h: 94 }, { key: 'BUDGET', owner: 'Operations' }, operations);
  const rejected = put('terminator', 1080, 451, 'On hold', { w: 126, h: 54, fill: '#fff0ef', stroke: '#d49c97', textColor: '#a2615b' }, { key: 'HOLD', status: 'Needs review' }, operations);
  const approve = put('process', 827, 638, 'Approve purchase', { w: 175, h: 78, fill: '#f2edfa', stroke: '#aa97c8', textColor: '#73578e' }, { key: 'FIN01', owner: 'Finance', status: 'Pending', sla: '1 day' }, finance);
  const end = put('terminator', 1080, 650, 'Approved', { w: 126, h: 54 }, { key: 'END', status: 'Complete' }, finance);
  const wire = (a, portA, b, portB, label = '', style = {}) => addEdge(page, { nodeId: a, port: portA }, { nodeId: b, port: portB }, label, style);
  wire(start, 'e', request, 'w'); wire(request, 'e', complete, 'w'); wire(complete, 's', review, 'n', 'Yes');
  wire(complete, 'e', update, 'w', 'No', { stroke: '#aa95bd' });
  wire(update, 'n', request, 'n', 'Resubmit', { dashed: true, stroke: '#aa95bd', waypoints: [{ x: 940, y: 225 }, { x: 396, y: 225 }] });
  wire(review, 'e', budget, 'w'); wire(budget, 'e', rejected, 'w', 'No', { stroke: '#c3938e' }); wire(budget, 's', approve, 'n', 'Yes'); wire(approve, 'e', end, 'w');
  put('text', 70, 802, '●  Start / end     ▬  Activity     ◇  Decision', { w: 710, h: 32, fontSize: 12, textColor: '#8896a6' });
  put('text', 940, 802, '9 activities  ·  3 responsible teams', { w: 310, h: 32, fontSize: 12, textColor: '#8896a6', align: 'right' });
  return doc;
}
