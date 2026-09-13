// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * A2A 适配层回归（D3，2026-09-13）
 *
 * 守护的是**协议契约本身**（依据《A2A 协议技术手册》）：
 *   - Agent Card 合规字段（§5.1 / §12.1）：identity / url / capabilities / security / skills，camelCase
 *   - 卡片**不得内嵌静态凭证**（§5.3）
 *   - 条件请求基础：ETag / 版本随能力集变化（§5.4）
 *   - 任务生命周期**终态不可重启**（§3.4）；取消语义（§4.4）
 *   - RPC 方法名兼容 v1.0 与早期绑定名（§11.3 / §12.4）
 */

import { describe, test, expect } from 'bun:test';
import type { AgentDefinition } from '../../src/agent/registry/AgentRegistry';
import {
  A2A_PROTOCOL_VERSION,
  buildAgentCard,
  computeAgentCardEtag,
  computeAgentCardVersion,
} from '../../src/agent/a2a/agentCard';
import { A2ATaskStore } from '../../src/agent/a2a/taskStore';
import {
  A2A_METHOD_ALIASES,
  A2A_METHODS,
  isTerminalState,
} from '../../src/agent/a2a/types';

function makeAgent(over: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    agentId: 'agent-a',
    name: '分析师',
    role: 'market_analyst',
    expertise: ['市场', '财报'],
    weight: 1,
    capabilities: ['code_review'],
    ...over,
  };
}

const CARD_OPTS = { baseUrl: 'http://127.0.0.1:9999/a2a', version: 'v1' };

describe('A2A Agent Card（§5.1 / §12.1）', () => {
  test('必备字段齐全且用 camelCase', () => {
    const card = buildAgentCard([makeAgent()], CARD_OPTS);

    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.name).toBeTruthy();
    expect(card.description).toBeTruthy();
    expect(card.url).toBe(CARD_OPTS.baseUrl);
    expect(card.provider.organization).toBeTruthy();
    expect(card.version).toBe('v1');
    expect(card.defaultInputModes.length).toBeGreaterThan(0);
    expect(card.defaultOutputModes.length).toBeGreaterThan(0);
    // §4.1/§4.2：未支持的能力必须如实声明为 false
    expect(card.capabilities.streaming).toBe(false);
    expect(card.capabilities.pushNotifications).toBe(false);
    expect(card.supportedInterfaces?.[0]?.protocolBinding).toBe('JSONRPC');
    expect(card.supportedInterfaces?.[0]?.protocolVersion).toBe(
      A2A_PROTOCOL_VERSION
    );
    // 字段名不得出现 snake_case 残漏（§6.2）
    expect(JSON.stringify(card)).not.toMatch(/"[a-z]+_[a-z]+":/);
  });

  test('skills 由 expertise + capabilities 映射，id 用 agentId', () => {
    const card = buildAgentCard([makeAgent()], CARD_OPTS);
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe('agent-a');
    expect(card.skills[0].name).toBe('分析师');
    expect(card.skills[0].tags).toEqual(['市场', '财报', 'code_review']);
  });

  test('卡片不内嵌静态凭证（§5.3）：只声明 securitySchemes', () => {
    const card = buildAgentCard(
      [makeAgent({ systemPrompt: '你是分析师' })],
      CARD_OPTS
    );
    const serialized = JSON.stringify(card);
    expect(card.securitySchemes?.bearer).toEqual({
      type: 'http',
      scheme: 'bearer',
    });
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]|api[_-]?key"|secret/i);
    // 模型名属实现细节，不得回写卡片（model-usage 规则）
    expect(serialized).not.toContain('"model"');
  });

  test('多 Agent → 多 skills；未注册 Agent 时仍产出合法空卡', () => {
    const card = buildAgentCard(
      [makeAgent(), makeAgent({ agentId: 'agent-b', name: '架构师' })],
      CARD_OPTS
    );
    expect(card.skills.map((s) => s.id)).toEqual(['agent-a', 'agent-b']);
    expect(buildAgentCard([], CARD_OPTS).skills).toEqual([]);
  });

  test('ETag / 版本随能力集变化（§5.4 条件请求基础）', () => {
    const a = buildAgentCard([makeAgent()], CARD_OPTS);
    const b = buildAgentCard([makeAgent()], CARD_OPTS);
    const c = buildAgentCard([makeAgent({ expertise: ['风控'] })], CARD_OPTS);

    expect(computeAgentCardEtag(a)).toBe(computeAgentCardEtag(b));
    expect(computeAgentCardEtag(a)).not.toBe(computeAgentCardEtag(c));
    expect(computeAgentCardVersion([makeAgent()])).toBe(
      computeAgentCardVersion([makeAgent()])
    );
    expect(computeAgentCardVersion([makeAgent()])).not.toBe(
      computeAgentCardVersion([makeAgent({ expertise: ['风控'] })])
    );
    // 定义顺序不应影响版本（排序后再哈希）
    const two = [makeAgent(), makeAgent({ agentId: 'agent-b' })];
    expect(computeAgentCardVersion(two)).toBe(
      computeAgentCardVersion([...two].reverse())
    );
  });
});

describe('A2A 任务生命周期（§3.4 / §4.4）', () => {
  test('新建为 submitted，完成后为终态并带 artifact', () => {
    const store = new A2ATaskStore();
    const task = store.create('ctx-1');
    expect(task.status.state).toBe('submitted');
    expect(task.contextId).toBe('ctx-1');

    const done = store.complete(task.id, 'completed', [
      { artifactId: 'a1', parts: [{ text: '结果' }] },
    ]);
    expect(done.status.state).toBe('completed');
    expect(done.artifacts?.[0]?.artifactId).toBe('a1');
    expect(isTerminalState(done.status.state)).toBe(true);
  });

  test('终态不可重启（§3.4）：重复 complete 抛错', () => {
    const store = new A2ATaskStore();
    const task = store.create();
    store.complete(task.id, 'failed', []);
    expect(() => store.complete(task.id, 'completed', [])).toThrow(/终态/);
  });

  test('取消语义：非终态可取消，终态不可取消（→ 上层映射 -32002）', () => {
    const store = new A2ATaskStore();
    const task = store.create();
    expect(store.cancel(task.id).status.state).toBe('canceled');
    expect(() => store.cancel(task.id)).toThrow(/终态/);
    expect(() => store.complete(task.id, 'completed', [])).toThrow(/终态/);
  });

  test('不存在的任务：get 返回 undefined，complete/cancel 抛错', () => {
    const store = new A2ATaskStore();
    expect(store.get('nope')).toBeUndefined();
    expect(() => store.complete('nope', 'completed', [])).toThrow(/不存在/);
    expect(() => store.cancel('nope')).toThrow(/不存在/);
  });

  test('保留上限：超过 200 条淘汰最旧', () => {
    const store = new A2ATaskStore();
    const first = store.create();
    for (let i = 0; i < 200; i += 1) store.create();
    expect(store.list()).toHaveLength(200);
    expect(store.get(first.id)).toBeUndefined();
  });
});

describe('A2A RPC 方法名兼容（§11.3 / §12.4）', () => {
  test('v1.0 抽象操作名与 JSON-RPC 绑定名映射到同一实现', () => {
    expect(A2A_METHOD_ALIASES['SendMessage']).toBe(A2A_METHODS.SendMessage);
    expect(A2A_METHOD_ALIASES['message/send']).toBe(A2A_METHODS.SendMessage);
    expect(A2A_METHOD_ALIASES['tasks/send']).toBe(A2A_METHODS.SendMessage);
    expect(A2A_METHOD_ALIASES['tasks/get']).toBe(A2A_METHODS.GetTask);
    expect(A2A_METHOD_ALIASES['CancelTask']).toBe(A2A_METHODS.CancelTask);
  });

  test('未登记方法名不做兜底猜测（→ -32601）', () => {
    expect(A2A_METHOD_ALIASES['tasks/list']).toBeUndefined();
    expect(A2A_METHOD_ALIASES['']).toBeUndefined();
  });
});
