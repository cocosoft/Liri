// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// task-agent 路由清单守卫（P3-2，2026-11-16）
//
// `dispatchTaskAgentRoutes` 是「顺序即语义」的路由表。按领域拆为四个同文件私有分发后，
// 分段顺序（任务登记 → Agent → Voice → TTS）与段内匹配顺序都必须保持；写反不会编译失败，
// 只会静默错配（例如 `/v1/tts/personas/default` 被泛匹配 `([^/]+)` 抢走）。
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const ROUTES = readFileSync(
  new URL(
    '../../src/infrastructure/http/handlers/routes/task-agent-routes.ts',
    import.meta.url
  ),
  'utf8'
);

const at = (needle: string) => ROUTES.indexOf(needle);
const countCalls = (handler: string) =>
  ROUTES.split(`await ${handler}(`).length - 1;

/** 各段 handler（与匹配顺序一致） */
const GROUPS: ReadonlyArray<{
  section: string;
  handlers: readonly string[];
}> = [
  {
    section: 'dispatchTaskRegistryRoutes',
    handlers: ['handleListTasks', 'handleCancelTask', 'handleRemoveTask'],
  },
  {
    section: 'dispatchAgentRoutes',
    handlers: [
      'handleListAgentTasks',
      'handleExecuteAgentTask',
      'handleGetAgentProgress',
      'handleGetAgentTaskState',
      'handleGetAgentTaskAudit',
      'handleGetAgentTaskLogs',
      'handleGetAgentTaskOutput',
      'handleRecoverAgentTask',
      'handleAgentTaskChat',
      'handleCancelAgentTask',
    ],
  },
  {
    section: 'dispatchVoiceRoutes',
    handlers: [
      'handleSTTTranscribe',
      'handleGetVoiceSettings',
      'handleUpdateVoiceSettings',
      'handleStartVoiceSession',
      'handleEndVoiceSession',
      'handleListVoiceSessions',
      'handleGetVoiceSession',
      'handleVoiceUpload',
      'handleVoiceStream',
      'handleTTSSynthesize',
      'handleListVoiceProviders',
      'handleVoiceHealth',
      'handleListVoices',
      'handleTestWakeWord',
      'handleWakeStart',
      'handleWakeStop',
      'handleWakeStatus',
    ],
  },
  {
    section: 'dispatchTtsRoutes',
    handlers: [
      'handleListTTSProviders',
      'handleSaveProviderConfig',
      'handleListPersonas',
      'handleCreatePersona',
      'handleGetDefaultPersona',
      'handleListPersonaBindings',
      'handleGetPersona',
      'handleUpdatePersona',
      'handleDeletePersona',
      'handleTTSSynthesizeAlias',
      'handleTTSStop',
      'handleTTSHealth',
      'handleSetDefaultPersona',
      'handleBindPersona',
      'handleUnbindPersona',
    ],
  },
];

describe('task-agent 路由清单', () => {
  it('每个 handler 各调用一次（无遗漏、无重复注册）', () => {
    for (const { handlers } of GROUPS) {
      for (const handler of handlers) {
        expect(countCalls(handler)).toBe(1);
      }
    }
  });

  it('主函数按 任务登记 → Agent → Voice → TTS 顺序串接四段', () => {
    const order = GROUPS.map((g) => at(`await ${g.section}(`));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]).toBeGreaterThan(-1);
      expect(order[i - 1]).toBeLessThan(order[i]!);
    }
  });

  it('段内 handler 顺序与匹配顺序一致', () => {
    for (const { handlers } of GROUPS) {
      const positions = handlers.map((h) => at(`await ${h}(`));
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
      }
    }
  });

  it('personas 的精确 GET 先于泛匹配 ([^/]+)', () => {
    const specificDefault = at("url === '/v1/tts/personas/default'");
    const specificBindings = at("url === '/v1/tts/personas/bindings'");
    const generic = at('/^\\/v1\\/tts\\/personas\\/([^/]+)$/');
    expect(specificDefault).toBeGreaterThan(-1);
    expect(specificBindings).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(-1);
    expect(specificDefault).toBeLessThan(generic);
    expect(specificBindings).toBeLessThan(generic);
  });

  it('每段与主函数都以 return false 兜底（未匹配不得吞请求）', () => {
    // 四个分段函数体 + 主函数体各一处兜底
    expect(ROUTES.split('  return false;\n}').length - 1).toBe(5);
    expect(ROUTES.trimEnd().endsWith('return false;\n}')).toBe(true);
  });
});
