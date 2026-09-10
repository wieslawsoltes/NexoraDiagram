import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/core/model.js';
import { CollaborationDocument } from '../src/core/collaboration.js';
import { CollaborationSession } from '../src/ui/collaboration.js';

// Exercise session message handling with the real document validator/merge engine.
// Browser CI separately tests actual BroadcastChannel and WebRTC transports.
function fixture() {
  const doc = createDocument('Reconnect status');
  const session = Object.create(CollaborationSession.prototype);
  Object.assign(session, {
    app: { store: { pending: null }, requestFrame() {}, ui: { showToast() {} } },
    peer: 'peer_local', room: 'status_test', ready: true, disposed: false,
    engine: new CollaborationDocument(doc, 'peer_local'),
    sent: new Set(), peers: new Map(), relay() {}, send() {},
  });
  const snapshot = () => ({
    transport: 'nexora.peer.v1', room: session.room, sender: 'peer_remote', id: 'status-message',
    body: { type: 'state', documentId: doc.id, state: session.engine.snapshot() },
  });
  return { session, snapshot };
}

test('validated reconnect clears transient transport status but retains diagnostic history', () => {
  const { session, snapshot } = fixture();
  session.error(new Error('Peer data channel failed.'), 'transport');
  assert.equal(session.lastError, 'Peer data channel failed.');
  session.receive(snapshot(), { readyState: 'open' });
  assert.equal(session.transportError, null);
  assert.equal(session.lastError, null);
  assert.equal(session.errorHistory.length, 1);
  assert.equal(session.errorHistory[0].kind, 'transport');
});

test('successful reconnection never hides document validation errors', () => {
  const { session, snapshot } = fixture();
  session.error(new Error('Invalid remote geometry'));
  session.error(new Error('Connection interrupted'), 'transport');
  session.receive(snapshot(), { readyState: 'open' });
  assert.equal(session.transportError, null);
  assert.equal(session.lastError, 'Invalid remote geometry');
  assert.equal(session.errorHistory.length, 2);
});

test('invalid remote snapshots cannot acknowledge transport recovery', () => {
  const { session, snapshot } = fixture();
  session.error(new Error('Connection interrupted'), 'transport');
  const packet = snapshot();
  packet.body.state.protocol = 'invalid';
  session.receive(packet, { readyState: 'open' });
  assert.equal(session.transportError, 'Connection interrupted');
  assert.match(session.lastError, /Unknown collaboration protocol/);
});

test('broadcast and closed channels cannot clear remote transport failures', () => {
  const { session, snapshot } = fixture();
  session.error(new Error('Connection interrupted'), 'transport');
  session.receive(snapshot(), 'broadcast');
  session.receive(snapshot(), { readyState: 'closed' });
  assert.equal(session.lastError, 'Connection interrupted');
  for (let i = 0; i < 40; i++) session.error(new Error(`Failure ${i}`), 'transport');
  assert.equal(session.errorHistory.length, 32);
  session.disposed = true;
  session.error(new Error('Late callback'));
  session.receive(snapshot(), { readyState: 'open' });
  assert.equal(session.lastError, 'Failure 39');
});
