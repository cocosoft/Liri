/**
 * VoiceGatewayBridge
 * 连接 GatewayServer 与 voice 子系统
 * 在 GatewayServer 的 /voice 端点上创建 VoiceSession
 */

import { Logger, LogLevel } from '@modules/monitoring';
import type { IncomingMessage, ServerResponse } from 'http';
import { upgradeToVoiceConnection } from './upgrade';
import { VoiceSession } from './VoiceSession';
import type { SessionIntegrationOptions } from './VoiceSession';
import type { VoiceConnection } from './types';
import type { SessionManager } from '@modules/session/SessionManager';
import type { TranscriptManager } from '@modules/session/TranscriptManager';
import { withTraceContextFromRequestResult } from '../monitoring/tracing/traceContextExtractor';

const logger = new Logger({
  module: 'voice:gatewayBridge',
  level: LogLevel.INFO,
});

/** 活跃的语音会话映射 */
const sessions = new Map<string, VoiceSession>();

/** 集成上下文（由 VoiceServiceBridge 初始化时设置） */
let integrationContext: SessionIntegrationOptions | null = null;

/**
 * 设置语音会话集成上下文
 * 在 VoiceServiceBridge 初始化时调用，将 SessionManager/TranscriptManager
 * 注入到每个新建的 VoiceSession 中
 */
export function setVoiceIntegrationContext(
  sessionManager?: SessionManager,
  transcriptManager?: TranscriptManager
): void {
  integrationContext = { sessionManager, transcriptManager };
  logger.info('语音集成上下文已设置', {
    hasSessionManager: !!sessionManager,
    hasTranscriptManager: !!transcriptManager,
  });
}

/**
 * 清除语音会话集成上下文
 */
export function clearVoiceIntegrationContext(): void {
  integrationContext = null;
  logger.info('语音集成上下文已清除');
}

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
  const upgrade = req.headers['upgrade']?.toLowerCase() ?? '';

  if (upgrade !== 'websocket') {
    logger.warn('非 WebSocket 升级请求', { upgrade });
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('WebSocket Upgrade Required');
    return false;
  }

  // P1-2.16: 在提取的 TraceContext 中升级连接，socket 事件监听器将继承该上下文
  const connection: VoiceConnection | null = withTraceContextFromRequestResult(
    req,
    () => upgradeToVoiceConnection(req, res)
  );
  if (!connection) {
    logger.warn('语音连接升级失败');
    return false;
  }

  const session = new VoiceSession(connection, integrationContext ?? undefined);

  sessions.set(session.id, session);
  logger.info('语音会话已创建', {
    sessionId: session.id,
    activeCount: sessions.size,
  });

  connection.onClose(() => {
    sessions.delete(session.id);
    logger.info('语音会话已关闭', {
      sessionId: session.id,
      activeCount: sessions.size,
    });
  });

  return true;
}

/**
 * 关闭所有活跃的语音会话
 */
export function closeAllVoiceSessions(): void {
  const count = sessions.size;
  logger.info('关闭所有语音会话', { count });
  for (const [id, session] of sessions) {
    session.close();
    sessions.delete(id);
  }
  logger.info('所有语音会话已关闭', { count });
}
