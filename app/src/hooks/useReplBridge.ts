/**
 * REPL桥接Hook
 * * 与Bridge模块集成，支持远程会话的输入输出
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BridgeMain,
} from '@modules/bridge/BridgeMain';
import { type BridgeSession } from '@modules/bridge/sessions/MultiSessionManager';
import { type BridgeMessage } from '@modules/bridge/messaging/BridgeMessaging';

/**
 * REPL状态
 */
export type ReplState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * REPL消息类型
 */
export interface ReplMessage {
  id: string;
  content: string;
  type: 'input' | 'output' | 'error' | 'system';
  timestamp: Date;
}

/**
 * useReplBridge Hook结果
 */
export interface UseReplBridgeResult {
  /** 当前状态 */
  state: ReplState;
  /** 消息历史 */
  messages: ReplMessage[];
  /** 当前会话 */
  session: BridgeSession | null;
  /** 是否正在执行 */
  isExecuting: boolean;
  /** 发送命令 */
  send: (command: string) => Promise<void>;
  /** 连接会话 */
  connect: (sessionId?: string) => Promise<void>;
  /** 断开连接 */
  disconnect: () => void;
  /** 清除消息 */
  clear: () => void;
}

/**
 * 生成消息ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * useReplBridge Hook
 * @returns REPL桥接状态和操作方法
 */
export function useReplBridge(): UseReplBridgeResult {
  const [state, setState] = useState<ReplState>('disconnected');
  const [messages, setMessages] = useState<ReplMessage[]>([]);
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const bridgeRef = useRef<BridgeMain | null>(null);

  // 添加消息
  const addMessage = useCallback(
    (content: string, type: ReplMessage['type']) => {
      const message: ReplMessage = {
        id: generateId(),
        content,
        type,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, message]);
    },
    []
  );

  // 消息处理
  const handleMessage = useCallback(
    (message: BridgeMessage) => {
      switch (message.type as string) {
        case 'output':
          addMessage(message.content, 'output');
          break;
        case 'error':
          addMessage(message.content, 'error');
          break;
        case 'system':
          addMessage(message.content, 'system');
          break;
        case 'input':
          addMessage(message.content, 'input');
          break;
      }
    },
    [addMessage]
  );

  // 连接会话
  const connect = useCallback(
    async (sessionId?: string) => {
      setState('connecting');
      try {
        bridgeRef.current = new BridgeMain({} as any);

        const newSession = await (bridgeRef.current as any).connect(sessionId);
        setSession(newSession);
        setState('connected');
        addMessage('已连接到REPL会话', 'system');

        // 设置消息处理器
        newSession.on('message', handleMessage);
        newSession.on('error', (error: Error) => {
          addMessage(`错误: ${error.message}`, 'error');
          setState('error');
        });
        newSession.on('disconnect', () => {
          setState('disconnected');
          addMessage('会话已断开', 'system');
        });
      } catch (error) {
        setState('error');
        addMessage(`连接失败: ${(error as Error).message}`, 'error');
      }
    },
    [addMessage, handleMessage]
  );

  // 断开连接
  const disconnect = useCallback(() => {
    if (bridgeRef.current) {
      (bridgeRef.current as any).disconnect();
      bridgeRef.current = null;
    }
    setSession(null);
    setState('disconnected');
    addMessage('已断开连接', 'system');
  }, [addMessage]);

  // 发送命令
  const send = useCallback(
    async (command: string) => {
      if (!session || state !== 'connected') {
        addMessage('未连接到会话', 'error');
        return;
      }

      setIsExecuting(true);
      addMessage(command, 'input');

      try {
        await (session as any).send(command);
      } catch (error) {
        addMessage(`执行失败: ${(error as Error).message}`, 'error');
      } finally {
        setIsExecuting(false);
      }
    },
    [session, state, addMessage]
  );

  // 清除消息
  const clear = useCallback(() => {
    setMessages([]);
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    state,
    messages,
    session,
    isExecuting,
    send,
    connect,
    disconnect,
    clear,
  };
}
