// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * sessionManagerFacade — 「会话管理器」视图对象外移（issue #17 · D4，2026-10-29）
 *
 * 迁出来源：`ChatManager.getSessionManager` 的方法体（原 3208–3251，约 44 行）。
 *
 * 该对象是给**外部消费方**（HTTP 处理器 / runtime API / 命令层）的**只读 + 少量写**视图：
 * 会话读写、消息追加、检查点门面。它不持有状态，全部操作转交给宿主端口。
 *
 * 行为不变：`ChatManager.getSessionManager()` 的对外签名仍是 `any`（接口契约不改），
 * 内部实现改为本工厂返回的同形对象。
 */

import { DataSessionStatus } from '@openliri/kernel';
import type { ChatSession } from '@modules/session/types/session';
import type { Message } from '@modules/session/types/message';
import type { SessionCheckpoint } from '@modules/session/types/checkpoint';
import type { SessionCheckpointService } from '../services/SessionCheckpointService';

export interface SessionManagerFacadePorts {
  getLocalSession: (
    sessionId: string | null | undefined
  ) => ChatSession | undefined;
  currentSessionIdRef: { get: () => string | null; set: (id: string) => void };
  chatSessions: Map<string, ChatSession>;
  addAndPersistMessage: (sessionId: string, message: Message) => Promise<void>;
  checkpointService: SessionCheckpointService;
}

/** 视图对象形状（仅用于本模块自证；对外仍以宿主的 `any` 签名暴露） */
export interface SessionManagerFacade {
  getSession(id: string): ChatSession | undefined;
  getCurrentSession(): ChatSession | undefined;
  setCurrentSession(id: string): void;
  getSessions(): ChatSession[];
  addMessage(id: string, msg: Message): Promise<void>;
  deleteSession(id: string): void;
  saveSession(session: ChatSession): void;
  loadSession(id: string): Promise<ChatSession | undefined>;
  loadSessions(): Promise<ChatSession[]>;
  createCheckpoint(sessionId: string, label?: string): Promise<string>;
  listCheckpoints(sessionId: string): Promise<SessionCheckpoint[]>;
  rollbackToCheckpoint(
    checkpointId: string
  ): ReturnType<SessionCheckpointService['rollbackToCheckpoint']>;
  deleteCheckpoint(checkpointId: string): Promise<void>;
  deleteSessionCheckpoints(sessionId: string): Promise<void>;
  getLatestCheckpoint(sessionId: string): Promise<SessionCheckpoint | null>;
}

export function createSessionManagerFacade(
  ports: SessionManagerFacadePorts
): SessionManagerFacade {
  return {
    getSession: (id: string) => ports.getLocalSession(id),
    getCurrentSession: () =>
      ports.getLocalSession(ports.currentSessionIdRef.get()),
    setCurrentSession: (id: string) => {
      ports.currentSessionIdRef.set(id);
    },
    getSessions: () => Array.from(ports.chatSessions.values()),
    addMessage: (id: string, msg: Message) =>
      ports.addAndPersistMessage(id, msg),
    deleteSession: (id: string) => {
      ports.chatSessions.delete(id);
    },
    saveSession: (s: ChatSession) => {
      ports.chatSessions.set(s.id, s);
    },
    loadSession: (id: string) => Promise.resolve(ports.getLocalSession(id)),
    loadSessions: () =>
      Promise.resolve(Array.from(ports.chatSessions.values())),
    createCheckpoint: (sessionId: string, label?: string) =>
      ports.checkpointService
        .saveCheckpointWithData(
          sessionId,
          ports.getLocalSession(sessionId)?.messages || [],
          ports.getLocalSession(sessionId)?.metadata || { title: '' },
          ports.getLocalSession(sessionId)?.state || DataSessionStatus.ACTIVE,
          label
        )
        .then((cp) => cp.id),
    listCheckpoints: (sessionId: string) =>
      ports.checkpointService.listCheckpoints(sessionId),
    rollbackToCheckpoint: (checkpointId: string) =>
      ports.checkpointService.rollbackToCheckpoint(checkpointId, {
        messages: [],
        metadata: { title: '' },
        state: DataSessionStatus.ACTIVE,
      }),
    deleteCheckpoint: (checkpointId: string) =>
      ports.checkpointService.deleteCheckpoint(checkpointId),
    deleteSessionCheckpoints: (sessionId: string) =>
      ports.checkpointService.deleteSessionCheckpoints(sessionId),
    getLatestCheckpoint: (sessionId: string) =>
      ports.checkpointService.getLatestCheckpoint(sessionId),
  };
}
