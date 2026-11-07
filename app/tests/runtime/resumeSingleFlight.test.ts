// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `resumePdcaOnce` —— 审批续跑**单飞**（2026-11-07 隐藏缺陷 #3）。
 *
 * 背景：`resumeAfterApproval` 有两条入口（Inbox 审批 / CLI `/goal approve`），编排器
 * 内部无互斥 ⇒ 并发会同时进入执行循环（工具副作用重复）。单飞要求：
 * ① **同时**到达的两次调用只跑一个循环；② 串行到达的调用仍各自执行（D16 的早批重试依赖它）。
 */
import { describe, expect, it } from 'bun:test';
import { resumePdcaOnce } from '@openliri/service/runtime/resumeSingleFlight';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('resumePdcaOnce（单飞）', () => {
  it('并发两次 ⇒ 只跑一次，且两方拿到同一结果', async () => {
    let calls = 0;
    const host = {};
    const run = async (): Promise<{ phase: string }> => {
      calls += 1;
      await sleep(10);
      return { phase: 'execute' };
    };

    const [a, b] = await Promise.all([
      resumePdcaOnce(host, run),
      resumePdcaOnce(host, run),
    ]);

    expect(calls).toBe(1);
    expect(a.phase).toBe('execute');
    expect(b.phase).toBe('execute');
  });

  it('串行两次 ⇒ 各跑一次（不是永久去重）', async () => {
    let calls = 0;
    const host = {};
    const run = async (): Promise<{ phase: string }> => {
      calls += 1;
      return { phase: 'execute' };
    };

    await resumePdcaOnce(host, run);
    await resumePdcaOnce(host, run);

    expect(calls).toBe(2);
  });

  it('首次失败后释放占位 ⇒ 下一次仍能执行', async () => {
    let calls = 0;
    const host = {};
    const failing = async (): Promise<{ phase: string }> => {
      calls += 1;
      throw new Error('PDCA_NOT_PENDING');
    };

    await expect(resumePdcaOnce(host, failing)).rejects.toThrow(
      'PDCA_NOT_PENDING'
    );
    await expect(
      resumePdcaOnce(host, async () => {
        calls += 1;
        return { phase: 'execute' };
      })
    ).resolves.toEqual({ phase: 'execute' });
    expect(calls).toBe(2);
  });
});
