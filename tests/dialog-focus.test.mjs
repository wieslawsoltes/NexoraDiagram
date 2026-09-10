import test from 'node:test';
import assert from 'node:assert/strict';
import { Panels } from '../src/ui/panels.js';

test('opening a dialog focuses immediately and never steals focus from a later field', async () => {
  const originalDocument = globalThis.document;
  let focused = null;
  const first = { focus() { focused = 'first'; } };
  const second = { focus() { focused = 'second'; } };
  const elements = {
    'dialog-title': { textContent: '' },
    'dialog-body': { innerHTML: '', querySelector: () => first },
    'dialog-footer': { innerHTML: '' },
    dialog: { showModal() {} },
  };
  globalThis.document = { getElementById: id => elements[id] };
  try {
    const panels = new Panels({});
    panels.dialog('Edit', '<input><input>', () => {});
    const initialFocus = focused;
    second.focus();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(initialFocus, 'first', 'initial focus must not be deferred');
    assert.equal(focused, 'second', 'typing in another field must retain focus');
  } finally {
    globalThis.document = originalDocument;
  }
});
