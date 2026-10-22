/**
 * modelConfigRefs — 「模型失效后清理任务分工/当前模型引用」的单一实现（2026-10-22）
 *
 * 背景（实测缺陷）：删除供应商只把强绑定模型置 `enabled=0`（N-59），**不删模型** ⇒
 * `ai_app_model_configs` 里的 `current` / 任务分工仍指着这些"孤儿模型"（例如本机
 * `current` → 大瓦特私有化，而它的 provider 已被删除）⇒ 切到该任务时报
 * 「供应商未找到或未启用」。
 *
 * 本文件锁的是**清理判据**（只删指向该模型的行、其余不动、空 ID 不动），
 * 用内存假 store ⇒ 不碰真实 `~/.pyapp/data/app.db`。
 */
import { describe, it, expect } from 'bun:test';

import {
  purgeModelRefs,
  type ModelConfigRefStore,
} from '../../src/ai/models/modelConfigRefs.js';

interface FakeStore extends ModelConfigRefStore {
  deleted: string[];
  remaining(): Record<string, string>;
}

function makeStore(initial: Record<string, string>): FakeStore {
  const rows = new Map(Object.entries(initial));
  const deleted: string[] = [];
  return {
    deleted,
    async getConfig(appType: string) {
      const model = rows.get(appType);
      return model === undefined ? null : { model };
    },
    async deleteConfig(appType: string) {
      rows.delete(appType);
      deleted.push(appType);
      return true;
    },
    remaining() {
      return Object.fromEntries(rows);
    },
  };
}

const APP_TYPES = [
  'default',
  'chat',
  'vision',
  'current',
  'phase_plan',
  'phase_execute',
] as const;

describe('purgeModelRefs：只清指向该模型的配置行', () => {
  it('返回并删除命中的 app_type（含 default / current / phase_*）', async () => {
    const store = makeStore({
      default: 'orphan-model',
      chat: 'orphan-model',
      vision: 'other-model',
      current: 'orphan-model',
      phase_plan: 'orphan-model',
      phase_execute: 'other-model',
    });

    const purged = await purgeModelRefs('orphan-model', store, APP_TYPES);

    expect(purged).toEqual(['default', 'chat', 'current', 'phase_plan']);
    expect(store.deleted).toEqual(['default', 'chat', 'current', 'phase_plan']);
    // 其它模型的配置**原样保留**（这是"只清孤儿引用"的核心约束）
    expect(store.remaining()).toEqual({
      vision: 'other-model',
      phase_execute: 'other-model',
    });
  });

  it('幂等：重复清理不再命中（第二次返回空）', async () => {
    const store = makeStore({ chat: 'orphan-model' });
    expect(await purgeModelRefs('orphan-model', store, APP_TYPES)).toEqual([
      'chat',
    ]);
    expect(await purgeModelRefs('orphan-model', store, APP_TYPES)).toEqual([]);
  });

  it('只检查传入的 app_type（未列出的行不动）', async () => {
    const store = makeStore({ chat: 'orphan-model', image: 'orphan-model' });
    expect(await purgeModelRefs('orphan-model', store, ['chat'])).toEqual([
      'chat',
    ]);
    expect(store.remaining()).toEqual({ image: 'orphan-model' });
  });

  it('空 modelId ⇒ 一律不动（`model === ""` 的"未配置"行不能被误当命中）', async () => {
    const store = makeStore({ chat: '', current: '' });
    expect(await purgeModelRefs('', store, APP_TYPES)).toEqual([]);
    expect(store.deleted).toEqual([]);
    expect(store.remaining()).toEqual({ chat: '', current: '' });
  });

  it('没有配置行（全 null）⇒ 空结果，不写盘', async () => {
    const store = makeStore({});
    expect(await purgeModelRefs('orphan-model', store, APP_TYPES)).toEqual([]);
    expect(store.deleted).toEqual([]);
  });
});
