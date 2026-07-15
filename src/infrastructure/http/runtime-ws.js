/**
 * AgentRuntime WebSocket 连接 / 心跳 / 统计辅助
 * 由 AgentRuntime 类方法薄包装委托，不改变对外行为。
 */
import RuntimeUtil from '#utils/runtime-util.js';
import runtimeConfig from '#infrastructure/config/config.js';

/**
 * @param {import('../../agent-runtime.js').default} runtime
 * @param {string} wsPath
 */
export function getWsHandlersForPath(runtime, wsPath) {
  const rawHandlers = runtime.wsf?.[wsPath];
  if (!Array.isArray(rawHandlers)) return [];
  return rawHandlers.filter(Boolean);
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 * @param {string} wsPath
 */
export function isWsPathSkipAuth(runtime, wsPath) {
  const handlers = getWsHandlersForPath(runtime, wsPath);
  return handlers.some((entry) => Boolean(entry && entry.skipAuth === true));
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 * @param {string} wsPath
 */
export function shouldRequireWsApiAuth(runtime, wsPath) {
  const apiKeyEnabled = runtimeConfig.server?.auth?.apiKey?.enabled !== false;
  if (!apiKeyEnabled) return false;
  if (isWsPathSkipAuth(runtime, wsPath)) return false;
  return true;
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 */
export function startWebSocketHeartbeat(runtime) {
  if (runtime._wsHeartbeatInterval) return;

  const interval = runtimeConfig.server.websocket?.heartbeatInterval || 30000;
  const timeout = runtimeConfig.server.websocket?.heartbeatTimeout || 60000;

  runtime._wsHeartbeatInterval = setInterval(() => {
    const now = Date.now();
    const deadConnections = [];

    for (const [id, conn] of runtime._wsConnections.entries()) {
      if (now - conn.lastPing > timeout) {
        deadConnections.push(id);
        try {
          conn.terminate();
        } catch {
          // 忽略已关闭的连接
        }
        continue;
      }

      if (conn.readyState === conn.OPEN) {
        try {
          conn.isAlive = false;
          conn.ping();
        } catch {
          deadConnections.push(id);
        }
      } else {
        deadConnections.push(id);
      }
    }

    for (const id of deadConnections) {
      runtime._wsConnections.delete(id);
    }

    if (deadConnections.length > 0) {
      RuntimeUtil.makeLog("debug", `清理 ${deadConnections.length} 个WebSocket死连接`, '服务器');
    }
  }, interval);
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 */
export function stopWebSocketHeartbeat(runtime) {
  if (runtime._wsHeartbeatInterval) {
    clearInterval(runtime._wsHeartbeatInterval);
    runtime._wsHeartbeatInterval = null;
  }
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 */
export function getWebSocketStats(runtime) {
  const stats = {
    total: runtime._wsConnections.size,
    byPath: {},
    oldest: null,
    newest: null
  };

  let oldestTime = Infinity;
  let newestTime = 0;

  for (const [id, conn] of runtime._wsConnections.entries()) {
    const path = conn.path || 'unknown';
    stats.byPath[path] = (stats.byPath[path] || 0) + 1;

    if (conn.connectedAt) {
      if (conn.connectedAt < oldestTime) {
        oldestTime = conn.connectedAt;
        stats.oldest = { id, path, connectedAt: conn.connectedAt };
      }
      if (conn.connectedAt > newestTime) {
        newestTime = conn.connectedAt;
        stats.newest = { id, path, connectedAt: conn.connectedAt };
      }
    }
  }

  return stats;
}

/**
 * @param {import('../../agent-runtime.js').default} runtime
 * @param {object} req
 * @param {object} socket
 * @param {Buffer} head
 */
export function wsConnect(runtime, req, socket, head) {
  req.rid = `${req.socket.remoteAddress}:${req.socket.remotePort}-${req.headers["sec-websocket-key"]}`;
  req.sid = `ws://${req.headers.host || `${req.socket.localAddress}:${req.socket.localPort}`}${req.url}`;
  req.query = Object.fromEntries(new URL(req.sid).searchParams.entries());

  const pathStr = req.url.split('?')[0];
  const wsPath = pathStr.startsWith('/') ? pathStr.slice(1) : pathStr;

  if (!wsPath || !(wsPath in runtime.wsf)) {
    RuntimeUtil.makeLog("warn", `WebSocket路径未找到: ${req.url} (解析为: ${wsPath}), 可用路径: ${Object.keys(runtime.wsf).join(', ')}`, '服务器');
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    return socket.destroy();
  }

  if (shouldRequireWsApiAuth(runtime, wsPath) && !runtime.checkApiAuthorization(req, {
    forceAuth: wsPath === 'OneBotv11' && runtimeConfig.server?.auth?.onebot?.requireLoopbackAuth === true,
  })) {
    RuntimeUtil.makeLog('warn', `WebSocket 鉴权失败：${req.url} ip=${req.socket.remoteAddress}`, '服务器');
    try {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    } catch {}
    return socket.destroy();
  }

  RuntimeUtil.makeLog("debug", `WebSocket路径匹配: ${req.url} -> ${wsPath}`, '服务器');

  runtime.wss.handleUpgrade(req, socket, head, conn => {
    const connectionId = `${Date.now()}-${RuntimeUtil.shortId()}`;
    conn.id = connectionId;
    conn.path = wsPath;
    conn.remoteAddress = req.socket.remoteAddress;
    conn.connectedAt = Date.now();
    conn.lastPing = Date.now();
    conn.isAlive = true;

    runtime._wsConnections.set(connectionId, conn);

    RuntimeUtil.makeLog("debug", `WebSocket连接建立：${req.url} [${connectionId}]`, '服务器');

    conn.on("pong", () => {
      conn.isAlive = true;
      conn.lastPing = Date.now();
    });

    conn.on("error", err => {
      const errorMsg = Error.isError(err) ? err.message : String(err);
      RuntimeUtil.makeLog("error", `WebSocket错误 [${connectionId}]: ${errorMsg}`, '服务器');
      runtime._wsConnections.delete(connectionId);
    });

    conn.on("close", (code) => {
      RuntimeUtil.makeLog("debug", `WebSocket断开：${req.url} [${connectionId}] 代码: ${code}`, '服务器');
      runtime._wsConnections.delete(connectionId);
    });

    conn.on("message", (msg) => {
      try {
        conn.lastPing = Date.now();
        const logMsg = Buffer.isBuffer(msg) && msg.length > 1024 ?
          `[二进制消息，长度：${msg.length}]` : RuntimeUtil.String(msg);
        RuntimeUtil.makeLog("trace", `WS消息 [${connectionId}]: ${logMsg}`, '服务器');
      } catch (err) {
        const errorMsg = Error.isError(err) ? err.message : String(err);
        RuntimeUtil.makeLog("error", `WebSocket消息处理错误 [${connectionId}]: ${errorMsg}`, '服务器');
      }
    });

    conn.sendMsg = (msg, options = {}) => {
      try {
        if (conn.readyState !== conn.OPEN) {
          RuntimeUtil.makeLog("warn", `WebSocket未就绪，无法发送 [${connectionId}]`, '服务器');
          return false;
        }

        if (!Buffer.isBuffer(msg)) {
          msg = Buffer.from(typeof msg === 'string' ? msg : JSON.stringify(msg));
        }

        const logMsg = msg.length > 1024 ? `[二进制消息，长度：${msg.length}]` : RuntimeUtil.String(msg);
        RuntimeUtil.makeLog("trace", `WS发送 [${connectionId}]: ${logMsg}`, '服务器');

        return conn.send(msg, options);
      } catch (err) {
        const errorMsg = Error.isError(err) ? err.message : String(err);
        RuntimeUtil.makeLog("error", `WebSocket发送错误 [${connectionId}]: ${errorMsg}`, '服务器');
        runtime._wsConnections.delete(connectionId);
        return false;
      }
    };

    startWebSocketHeartbeat(runtime);

    try {
      const handlers = getWsHandlersForPath(runtime, wsPath);
      for (const entry of handlers) {
        const fn = typeof entry === 'function' ? entry : entry.handler;
        if (typeof fn === 'function') {
          fn(conn, req, socket, head);
        }
      }
    } catch (err) {
      const errorMsg = Error.isError(err) ? err.message : String(err);
      RuntimeUtil.makeLog("error", `WebSocket处理器错误 [${connectionId}]: ${errorMsg}`, '服务器');
    }
  });
}
