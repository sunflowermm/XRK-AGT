import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProcessSignalController,
  SIGNAL_STRIKE_WINDOW_MS,
  SIGNAL_STRIKES_TO_EXIT,
  WIN_STATUS_CONTROL_C_EXIT,
  normalizeChildExitCode,
  syncSignalNotice
} from '../../src/utils/process-signals.js';

describe('ProcessSignalController 连击计数', () => {
  it('_bumpStrike 窗口内递增', () => {
    const ctrl = new ProcessSignalController({ mode: 'server' });
    assert.equal(ctrl._bumpStrike('SIGINT'), 1);
    assert.equal(ctrl._bumpStrike('SIGINT'), 2);
    assert.equal(ctrl._bumpStrike('SIGINT'), 3);
  });

  it('_bumpStrike 超窗口重置', () => {
    const ctrl = new ProcessSignalController({ mode: 'server' });
    ctrl._bumpStrike('SIGINT');
    ctrl.lastStrikeTime = Date.now() - SIGNAL_STRIKE_WINDOW_MS - 1;
    assert.equal(ctrl._bumpStrike('SIGINT'), 1);
  });

  it('pause 时跳过；resume + resetStrikes 清空', async () => {
    let called = false;
    const ctrl = new ProcessSignalController({
      mode: 'server',
      onRestart: () => {
        called = true;
      }
    });
    ctrl.pause();
    await ctrl._handle('SIGINT');
    assert.equal(called, false);
    ctrl._bumpStrike('SIGINT');
    ctrl.resetStrikes();
    assert.equal(ctrl.strikeCount, 0);
  });

  it('第 1 次重启不阻塞第 2 次提示', async () => {
    const logs = [];
    let stopCalled = false;
    const ctrl = new ProcessSignalController({
      mode: 'server',
      logger: { mark: (m) => logs.push(m) },
      onRestart: () => new Promise(() => {}),
      onStop: () => {
        stopCalled = true;
      }
    });
    await ctrl._handle('SIGINT');
    await ctrl._handle('SIGINT');
    assert.ok(logs.some((m) => m.includes('重启')));
    assert.ok(logs.some((m) => m.includes('再按 1 次')));
    assert.equal(stopCalled, false);
  });
});

describe('normalizeChildExitCode', () => {
  it('Windows Ctrl+C 映射为 EXIT_STOP', () => {
    assert.equal(normalizeChildExitCode(WIN_STATUS_CONTROL_C_EXIT, 0), 0);
    assert.equal(normalizeChildExitCode(-1073741510, 0), 0);
  });

  it('普通重启码保持', () => {
    assert.equal(normalizeChildExitCode(1, 0), 1);
  });
});

describe('syncSignalNotice', () => {
  it('可调用且不抛错', () => {
    assert.doesNotThrow(() => syncSignalNotice('[test] ping'));
  });
});

describe('默认三击退出', () => {
  it('strikesToExit 默认为 3', () => {
    const ctrl = new ProcessSignalController({ mode: 'menu' });
    assert.equal(ctrl.strikesToExit, SIGNAL_STRIKES_TO_EXIT);
  });
});
