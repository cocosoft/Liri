/**
 * 通道 × 工具 × 存储 **场景矩阵**（2026-11-06）
 *
 * 依据：`dev_docs/20261101/工作计划-20261101.md` §七「剩余（未做）」唯一项
 *（通道 × 工具 × 存储场景矩阵，此前因 CI 时长预算未启动）。
 *
 * 规模（与裁定一致）：**3 通道 × 4 工具 × 2 存储 = 24 个组合**，全部用真实实现 +
 * 临时目录（`mkdtempSync`）/ 内存实现，不使用 mock 数据（CS04），目标 < 5s。
 *
 * 只断言**跨层不变式**，不复测各层单测已覆盖的细节：
 * | 组 | 不变式 |
 * |---|---|
 * | ① 通道 ⇒ 工具面 | 所有远程通道统一 `messaging`：写盘 / 执行类不下发，只读保留 |
 * | ② 通道 ⇒ 入站路由 | 一次入站 ⇒ 恰好一次 `chatStream`、一次出站；**同 messageId 跨通道不误去重** |
 * | ③ 存储 ⇒ 落库读回 | 内存与临时 FS 后端可观测一致；两个身份的会话互不串 |
 * | ④ 全组合 | 24 个组合下「工具面判定」与「落库读回」互不影响 |
 */
import '@openliri/kernel';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getExecutionManager } from '@openliri/service/execution';
import { routeChannelMessage } from '@modules/channels/routing/messageRouter';
import {
  CHANNEL_MESSAGING_TASK_TYPE,
  resolveChannelToolPolicy,
} from '@modules/channels/toolPolicy';
import type { MessageContext } from '@modules/channels/types/IChannel';
import { getRealToolNamesForTask } from '../../src/tools/toolCategories';
import { FileSystemUnifiedStorage } from '@modules/session/storage/FileSystemUnifiedStorage';
import { StorageFactory } from '@modules/session/storage/StorageFactory';
import {
  StorageType,
  type UnifiedSessionStorage,
} from '@modules/session/storage/UnifiedStorage';
import {
  MessageRole,
  MessageType,
  type UnifiedMessage,
} from '@modules/session/types/UnifiedMessage';
import {
  SessionStatus,
  SessionType,
  type UnifiedSession,
} from '@modules/session/types/UnifiedSession';

/** 通道维度：取目录内的三个真实通道（含两个 IM 与一个通用 bot 通道） */
const CHANNELS = ['feishu', 'dingtalk', 'telegram'] as const;
/** 工具维度：读 / 写 / 执行 / 命令 —— 覆盖「只读保留、其余收窄」的两侧 */
const TOOLS = ['file_read', 'file_write', 'bash', 'powershell'] as const;
/** 存储维度：内存实现 / 临时文件系统实现（均真实实现，非替身） */
const STORAGE_KINDS = ['memory', 'filesystem'] as const;

type Channel = (typeof CHANNELS)[number];
type Tool = (typeof TOOLS)[number];
type StorageKind = (typeof STORAGE_KINDS)[number];

/** 远程通道（`messaging` 任务面）**不得**下发的工具：写盘与执行类 */
const BANNED_ON_CHANNEL = new Set<string>(['file_write', 'bash', 'powershell']);

let seq = 0;
const uniq = (prefix: string): string => `${prefix}-${Date.now()}-${++seq}`;

const openedStorages: UnifiedSessionStorage[] = [];
const tempDirs: string[] = [];

async function createStorage(
  kind: StorageKind
): Promise<UnifiedSessionStorage> {
  let store: UnifiedSessionStorage;
  if (kind === 'memory') {
    store = StorageFactory.createMemoryStorage();
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'matrix-store-'));
    tempDirs.push(dir);
    store = new FileSystemUnifiedStorage({
      type: StorageType.FILESYSTEM,
      basePath: dir,
      // 只测本实例：不去扫本机共享的 sessions/* 历史分区
      discoverLegacyRoots: false,
    });
  }
  await store.initialize();
  openedStorages.push(store);
  return store;
}

function makeInbound(
  channelId: Channel,
  senderId: string,
  messageId: string
): MessageContext {
  return {
    channelId,
    senderId,
    messageId,
    messageType: 'text',
    content: `hello from ${senderId}`,
    timestamp: Date.now(),
    isDirectMessage: true,
    rawPayload: {},
  };
}

function okCoreAPI(reply: string, onStream?: () => void) {
  return {
    chat: async () => ({ content: reply }),
    chatStream: async function* () {
      onStream?.();
      yield { type: 'text' as const, content: reply, sessionId: '' };
      return { content: reply, finishReason: 'stop' };
    },
  };
}

function makeSession(id: string, userId: string): UnifiedSession {
  const now = Date.now();
  return {
    id,
    type: SessionType.CHAT,
    title: `会话-${id}`,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    status: SessionStatus.ACTIVE,
    metadata: { owner: { tenantId: 'tenant-matrix', userId } },
  };
}

function makeStoredMessage(sessionId: string, content: string): UnifiedMessage {
  return {
    id: uniq('msg'),
    sessionId,
    type: MessageType.ASSISTANT,
    role: MessageRole.ASSISTANT,
    content,
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  getExecutionManager().reset();
});

afterEach(async () => {
  for (const store of openedStorages.splice(0)) {
    await store.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('① 通道 × 工具：远程通道统一 messaging（写盘 / 执行不下发）', () => {
  for (const channel of CHANNELS) {
    it(`${channel}：工具面与本地面同口径收窄`, () => {
      expect(resolveChannelToolPolicy(channel)).toBe('messaging');
      const names = getRealToolNamesForTask(CHANNEL_MESSAGING_TASK_TYPE);
      for (const tool of TOOLS) {
        if (BANNED_ON_CHANNEL.has(tool)) {
          expect(names).not.toContain(tool);
        } else {
          expect(names).toContain(tool);
        }
      }
    });
  }
});

describe('② 通道 × 入站路由：一次入站 = 一次 chatStream / 一次出站', () => {
  for (const channel of CHANNELS) {
    it(`${channel}：入站被受理且只产生一次业务副作用`, async () => {
      const senderId = `${channel}-user`;
      let streams = 0;
      const outbound: string[] = [];
      const result = await routeChannelMessage(
        makeInbound(channel, senderId, uniq('in')),
        {
          coreAPI: okCoreAPI('pong', () => {
            streams += 1;
          }),
          channelName: channel,
          dmPolicy: { policy: 'allowlist', allowFrom: [senderId] },
          onOutbound: async (content) => {
            outbound.push(content);
          },
        }
      );
      expect(result.valid).toBe(true);
      expect(streams).toBe(1);
      expect(outbound).toHaveLength(1);
      expect(outbound[0]).toContain('pong');
    });
  }

  it('同 messageId 跨通道 ⇒ 不误去重（去重键含通道维度）', async () => {
    const messageId = uniq('shared');
    let streams = 0;
    const coreAPI = okCoreAPI('pong', () => {
      streams += 1;
    });
    await routeChannelMessage(makeInbound('feishu', 'u1', messageId), {
      coreAPI,
      channelName: 'feishu',
      dmPolicy: { policy: 'allowlist', allowFrom: ['u1'] },
    });
    await routeChannelMessage(makeInbound('dingtalk', 'u1', messageId), {
      coreAPI,
      channelName: 'dingtalk',
      dmPolicy: { policy: 'allowlist', allowFrom: ['u1'] },
    });
    expect(streams).toBe(2);
  });
});

describe('③ 存储 × 分区：落库读回与身份隔离（内存 / 临时 FS 同口径）', () => {
  for (const kind of STORAGE_KINDS) {
    it(`${kind}：两会话各自可读回，owner 不串、列表均可见`, async () => {
      const store = await createStorage(kind);
      const sessionA = makeSession(uniq('sess'), 'user-a');
      const sessionB = makeSession(uniq('sess'), 'user-b');
      await store.createSession(sessionA);
      await store.createSession(sessionB);
      await store.addMessage(
        sessionA.id,
        makeStoredMessage(sessionA.id, 'hello-a')
      );

      const [readA, readB, messagesA, listed] = await Promise.all([
        store.getSession(sessionA.id),
        store.getSession(sessionB.id),
        store.getMessages(sessionA.id),
        store.listSessions(),
      ]);

      expect(readA?.metadata.owner?.userId).toBe('user-a');
      expect(readB?.metadata.owner?.userId).toBe('user-b');
      expect(messagesA.map((m) => m.content)).toEqual(['hello-a']);
      expect(listed.map((s) => s.id).sort()).toEqual(
        [sessionA.id, sessionB.id].sort()
      );
    });
  }
});

describe('④ 全组合（3 通道 × 4 工具 × 2 存储）：工具面与落库互不影响', () => {
  for (const channel of CHANNELS) {
    for (const tool of TOOLS) {
      for (const kind of STORAGE_KINDS) {
        it(`${channel} × ${tool} × ${kind}`, async () => {
          // 工具面：只读保留、写/执行收窄（与本地面同一实现）
          const names = getRealToolNamesForTask(CHANNEL_MESSAGING_TASK_TYPE);
          expect(names.includes(tool)).toBe(!BANNED_ON_CHANNEL.has(tool));

          // 落库：同一会话仍可写入并读回（存储不受通道/工具面判定影响）
          const store = await createStorage(kind);
          const session = makeSession(uniq('sess'), `${channel}-user`);
          await store.createSession(session);
          await store.addMessage(
            session.id,
            makeStoredMessage(session.id, `${channel}:${tool}`)
          );
          const messages = await store.getMessages(session.id);
          expect(messages.map((m) => m.content)).toEqual([
            `${channel}:${tool}`,
          ]);
        });
      }
    }
  }
});
