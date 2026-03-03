import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import VolcengineASRClient from '../src/factory/asr/VolcengineASRClient.js';

function createClient() {
  const Bot = {
    _events: [],
    em(name, payload) {
      this._events.push({ name, payload });
    }
  };
  const config = {
    wsUrl: 'ws://127.0.0.1:65535', // 不会真的连接（测试里会 stub）
    appKey: 'x',
    accessKey: 'x',
    resourceId: 'x',
    wsMaxReconnectAttempts: 0
  };
  const client = new VolcengineASRClient('dev1', config, Bot);
  return { client, Bot };
}

test('VolcengineASRClient._emitAsrTimeoutOnce should dedupe by sessionId', () => {
  const { client, Bot } = createClient();
  client._emitAsrTimeoutOnce('s1', 'r1');
  client._emitAsrTimeoutOnce('s1', 'r2');
  client._emitAsrTimeoutOnce('s2', 'r3');

  const timeouts = Bot._events.filter(e => e.name === 'device.asr_timeout');
  assert.equal(timeouts.length, 2);
  assert.equal(timeouts[0].payload.session_id, 's1');
  assert.equal(timeouts[1].payload.session_id, 's2');
});

test('VolcengineASRClient.beginUtterance rotates old ws before connecting', async () => {
  const { client } = createClient();

  class FakeWs extends EventEmitter {
    constructor() {
      super();
      this.readyState = 1;
      this.closedArgs = null;
    }
    close(code, reason) {
      this.closedArgs = { code, reason };
      setImmediate(() => this.emit('close', code));
    }
    terminate() {
      setImmediate(() => this.emit('close', 1006));
    }
  }

  const oldWs = new FakeWs();
  client.ws = oldWs;
  client.connected = true;
  client.currentUtterance = { sessionId: 'old', ending: false };
  client.endUtterance = async () => true;

  client._ensureConnected = async () => {
    client.connected = true;
    client.ws = { send() {}, readyState: 1 };
  };

  await client.beginUtterance('newSid', { sample_rate: 16000, channels: 1, format: 'pcm', codec: 'pcm' });

  assert.deepEqual(oldWs.closedArgs, { code: 1000, reason: 'rotate utterance' });
  assert.equal(client.connected, true);
  assert.ok(client.currentUtterance);
  assert.equal(client.currentUtterance.sessionId, 'newSid');
});

