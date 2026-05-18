/**
 * VoiceGatewayBridge
 * 连接 GatewayServer 与 voice 子系统
 * 在 GatewayServer 的 /voice 端点上创建 VoiceSession
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { upgradeToVoiceConnection } from './upgrade';
import { VoiceSession } from './VoiceSession';
import type { VoiceConnection } from './types';

/** 活跃的语音会话映射 */
const sessions = new Map<string, VoiceSession>();

/**
 * 获取所有活跃会话
 */
export function getActiveVoiceSessions(): Map<string, VoiceSession> {
  return new Map(sessions);
}

/**
 * 获取指定会话
 */
export function getVoiceSession(sessionId: string): VoiceSession | undefined {
  return sessions.get(sessionId);
}

/**
 * 获取活跃会话数量
 */
export function getActiveVoiceSessionCount(): number {
  return sessions.size;
}

/**
 * 处理 /voice 端点的 WebSocket 升级请求
 * 由 GatewayServer 在路由匹配时调用
 * @param req HTTP 请求
 * @param res HTTP 响应
 * @returns 是否成功建立语音会话
 */
export function handleVoiceUpgrade(
  req: IncomingMessage,
  res: ServerResponse
): boolean {
  const wsAccept = req.headers['sec-websocket-version'];
  const upgrade = req.headers['upgrade']?.toLowerCase() ?? '';

  if (upgrade !== 'websocket') {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebSocket Upgrade Required');
    return false;
  }

  const connection: VoiceConnection | null = upgradeToVoiceConnection(req, res);
  if (!connection) {
    return false;
  }

  const session = new VoiceSession(connection);

  sessions.set(session.id, session);

  connection.onClose(() => {
    sessions.delete(session.id);
  });

  return true;
}

/**
 * 关闭所有活跃的语音会话
 */
export function closeAllVoiceSessions(): void {
  for (const [id, session] of sessions) {
    session.close();
    sessions.delete(id);
  }
}
