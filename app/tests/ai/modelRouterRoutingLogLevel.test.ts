// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-1（2026-11-04）：`ModelRouter.resolve: 路由决策` 日志分级。
 *
 * 真机窗口内 88 328 条中 **88 323 条**是 `source='configured'`（稳态命中），而"命中了哪个模型"
 * 已由请求快照（`RequestSnapshotService`：model + routeKey）逐请求落盘 ⇒ 本行只对
 * **回退来源 / 空结果**保留 INFO。本文件 pin 住该分级（判据 + 真实 `resolve()` 接线）。
 */
import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { getLogger } from '@openliri/infra/monitoring';
import {
  modelRouter,
  shouldLogRoutingDecisionAtInfo,
} from '../../src/ai/modelRouter';

const routerLogger = getLogger('ai:model-router');

/** `resolveInner` 是私有实现：测试按其真实入口（`resolve()` 内部调用）打桩 */
type ResolveInnerSeam = {
  resolveInner(taskType: string, decision: { source: string }): string;
};

function stubResolveInner(source: string, result: string) {
  const seam = modelRouter as unknown as ResolveInnerSeam;
  return spyOn(seam, 'resolveInner').mockImplementation(
    (_taskType: string, decision: { source: string }) => {
      decision.source = source;
      return result;
    }
  ) as unknown as { mockRestore(): void };
}

describe('shouldLogRoutingDecisionAtInfo：分级判据', () => {
  it('稳态命中（configured 且有结果）⇒ false（降 debug）', () => {
    expect(
      shouldLogRoutingDecisionAtInfo({ source: 'configured', result: 'm1' })
    ).toBe(false);
  });

  it('回退来源 / 未配置 / 空结果 ⇒ true（保留 INFO）', () => {
    for (const c of [
      { source: 'fallback-default', result: 'm1' },
      { source: 'fallback-current', result: 'm1' },
      { source: 'capability-unconfigured', result: '' },
      { source: 'hardcoded-default', result: 'm1' },
      { source: 'configured', result: '' },
    ]) {
      expect(shouldLogRoutingDecisionAtInfo(c)).toBe(true);
    }
  });
});

describe('ModelRouter.resolve 接线：哪条走哪个级别', () => {
  let infoSpy: ReturnType<typeof spyOn>;
  let debugSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    infoSpy?.mockRestore();
    debugSpy?.mockRestore();
  });

  const pick = (spy: ReturnType<typeof spyOn>) =>
    (spy.mock.calls as unknown[][]).filter(
      (c) => c[0] === 'ModelRouter.resolve: 路由决策'
    );

  it('configured 命中 ⇒ debug，INFO 为 0', () => {
    infoSpy = spyOn(routerLogger, 'info');
    debugSpy = spyOn(routerLogger, 'debug');
    const stub = stubResolveInner('configured', 'm1');
    try {
      expect(modelRouter.resolve('chat')).toBe('m1');
    } finally {
      stub.mockRestore();
    }
    expect(pick(infoSpy).length).toBe(0);
    expect(pick(debugSpy).length).toBe(1);
    expect(pick(debugSpy)[0][1]).toMatchObject({
      task: 'chat',
      model: 'm1',
      source: 'configured',
    });
  });

  it('回退来源 ⇒ 仍为 INFO（可观测"回退到了哪条"）', () => {
    infoSpy = spyOn(routerLogger, 'info');
    debugSpy = spyOn(routerLogger, 'debug');
    const stub = stubResolveInner('fallback-default', 'm-default');
    try {
      expect(modelRouter.resolve('reranking')).toBe('m-default');
    } finally {
      stub.mockRestore();
    }
    expect(pick(infoSpy).length).toBe(1);
    expect(pick(infoSpy)[0][1]).toMatchObject({
      task: 'reranking',
      source: 'fallback-default',
    });
    expect(pick(debugSpy).length).toBe(0);
  });
});
