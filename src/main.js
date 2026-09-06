import { DiagramApp } from './app.js';
import { Persistence } from './core/persistence.js';
import { parseDocument } from './core/model.js';
import { createDemo } from './core/template.js';
const persistence = new Persistence(); let doc, warning;
try {
  const recovery = localStorage.getItem('nexora-recovery');
  doc = recovery ? parseDocument(recovery) : await persistence.load();
} catch (error) { warning = `Saved project could not be restored: ${error.message}`; }
const app = new DiagramApp(doc || createDemo(), persistence);
window.nexora = app;
await app.initialize();
if (warning) app.ui.showToast(warning, true);
