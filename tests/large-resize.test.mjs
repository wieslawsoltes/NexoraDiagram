import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeGeometry } from '../src/core/drawing.js';

test('side resizing retains the inactive dimension on large infinite-canvas objects', () => {
  const shape = { x: 0, y: 0, w: 400000, h: 300000 };
  const south = resizeGeometry(shape, 's', { x: 200000, y: 350000 });
  assert.equal(south.w, shape.w);
  assert.equal(south.h, 350000);
  const east = resizeGeometry(shape, 'e', { x: 500000, y: 150000 });
  assert.equal(east.w, 500000);
  assert.equal(east.h, shape.h);
  const proportional = resizeGeometry(shape, 'se', { x: 800000, y: 600000 }, { proportional: true });
  assert.equal(proportional.w, 800000);
  assert.equal(proportional.h, 600000);
});
