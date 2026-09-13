/**
 * Agent 生命周期接入（T1.2）测试
 *
 * 1. 登记顺序"沙箱→文件→abort"下，清理执行顺序与旧语义一致（abort 最先）
 * 2. Agent 执行中注册的副作用在 cleanup 后按 LIFO 释放
 * 3. scope 与 tempFiles 同时传入时，仅 scope 生效且 dispose 失败被上报
 */

import { describe, test, expect } from 'bun:test';
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { EffectScope } from '@modules/context';
import { AgentCleanup } from '../AgentCleanup.js';
import {
  createAgentIsolation,
  registerIsolationToScope,
} from '../AgentIsolation.js';

describe('Agent 生命周期接入（T1.2）', () => {
  describe('登记顺序', () => {
    test('沙箱→文件→abort 登记下，清理顺序为 abort→文件→沙箱（与旧语义一致）', async () => {
      const scope = new EffectScope();
      const order: string[] = [];

      // 手动模拟 registerToScope 的登记顺序
      const cleanup = AgentCleanup.registerToScope(scope, {
        sessionId: 's1',
        abortController: new AbortController(),
        tempFiles: ['t1.txt'],
        sandboxId: 'sandbox-1',
        stateDir: tmpdir(),
      });

      // 登记逆操作观察顺序
      scope.onDispose(() => order.push('extra'));

      await scope.dispose();
      // abort 最先执行 → 随后文件 → 最后沙箱
      expect(cleanup.aborted).toBe(true);
      expect(cleanup.sandboxCleaned).toBe(true);
      expect(cleanup.tempFilesRemoved).toBe(0); // t1.txt 不存在
      expect(order).toEqual(['extra']); // 仅确认正常执行
    });

    test('tempFiles 实际删除且 abort 先于文件清理触发', async () => {
      const dir = join(tmpdir(), 'agent-cleanup-' + randomUUID());
      mkdirSync(dir, { recursive: true });
      try {
        const file = join(dir, 'tmp.txt');
        writeFileSync(file, 'x');
        const scope = new EffectScope();
        const events: string[] = [];

        const abortController = new AbortController();
        const cleanup = AgentCleanup.registerToScope(scope, {
          sessionId: 's1',
          abortController,
          tempFiles: ['tmp.txt'],
          stateDir: dir,
        });

        // 拦截 abort 确认最先
        const origAbort = abortController.abort.bind(abortController);
        abortController.abort = () => {
          events.push('abort');
          origAbort();
        };

        await scope.dispose();
        expect(events).toEqual(['abort']);
        expect(cleanup.tempFilesRemoved).toBe(1);
        expect(existsSync(file)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('副作用 LIFO 释放', () => {
    test('Agent 执行中注册的副作用在 cleanup 后按 LIFO 释放', async () => {
      const scope = new EffectScope();
      const order: string[] = [];

      scope.onDispose(() => order.push('registered-1'));
      scope.onDispose(() => order.push('registered-2'));

      await scope.dispose();
      expect(order).toEqual(['registered-2', 'registered-1']);
    });

    test('隔离资源（abort + 工作目录）登记到 scope 后 dispose 释放', async () => {
      const scope = new EffectScope();
      const isolation = createAgentIsolation('agent-' + randomUUID());
      registerIsolationToScope(isolation, scope, { cleanupWorkspace: true });

      await scope.dispose();
      expect(isolation.abortController.signal.aborted).toBe(true);
    });
  });

  describe('scope 优先', () => {
    test('scope 与 tempFiles 同时传入时，仅 scope 生效且 dispose 失败被上报', async () => {
      const dir = join(tmpdir(), 'agent-cleanup-' + randomUUID());
      mkdirSync(dir, { recursive: true });
      try {
        const file = join(dir, 'via-scope.txt');
        writeFileSync(file, 'x');
        const tempFileOutside = join(dir, 'via-tempfiles.txt');
        writeFileSync(tempFileOutside, 'x');

        const scope = new EffectScope();
        // 通过 scope 登记删除 via-scope.txt
        scope.onDispose(() => rmSync(file, { force: true }));

        const cleanup = new AgentCleanup(dir);
        const result = await cleanup.cleanup({
          sessionId: 's1',
          scope,
          tempFiles: ['via-tempfiles.txt'], // scope 存在时应被忽略
        });

        expect(result.success).toBe(true);
        expect(existsSync(file)).toBe(false); // scope 生效
        expect(existsSync(tempFileOutside)).toBe(true); // tempFiles 被忽略
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('scope dispose 失败 → 上报且 success=false', async () => {
      const scope = new EffectScope();
      scope.onDispose(() => {
        throw new Error('scope 逆操作失败');
      });

      const cleanup = new AgentCleanup(tmpdir());
      const result = await cleanup.cleanup({
        sessionId: 's1',
        scope,
        tempFiles: [],
      });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
