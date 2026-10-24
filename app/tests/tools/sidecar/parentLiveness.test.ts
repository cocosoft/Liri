/**
 * 父进程存活看门狗（基础设施专项 §6-#5 第一刀：子进程自清）。
 *
 * 自证四件事：① 键名/取值走产品前缀且默认当前 PID；② 未注入 ⇒ **完全不介入**；
 * ③ 父进程存活 ⇒ 不退出；④ 父进程消失 ⇒ 退出一次、停表、回调带父 PID。
 */

import { describe, expect, it } from 'bun:test';

import {
  installParentLivenessGuard,
  parentPidEnv,
  parentPidEnvKey,
} from '../../../src/utils/parentLiveness';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('父进程存活看门狗', () => {
  it('注入键名走产品前缀，值可取当前或指定 PID', () => {
    expect(parentPidEnvKey()).toBe('LIRI_SIDECAR_PARENT_PID');
    expect(parentPidEnv(1234)).toEqual({ LIRI_SIDECAR_PARENT_PID: '1234' });
    expect(parentPidEnv()[parentPidEnvKey()]).toBe(String(process.pid));
  });

  it('未注入父 PID ⇒ 不建定时器、不退出', async () => {
    let exits = 0;
    const dispose = installParentLivenessGuard({
      env: {},
      intervalMs: 5,
      isAlive: () => false,
      exit: () => {
        exits += 1;
      },
    });
    await sleep(25);
    dispose();
    expect(exits).toBe(0);
  });

  it('非法父 PID（abc / 0）⇒ 同样不介入', async () => {
    let exits = 0;
    for (const raw of ['abc', '0', '-1']) {
      installParentLivenessGuard({
        env: { [parentPidEnvKey()]: raw },
        intervalMs: 5,
        isAlive: () => false,
        exit: () => {
          exits += 1;
        },
      });
    }
    await sleep(25);
    expect(exits).toBe(0);
  });

  it('父进程存活 ⇒ 持续运行不退出', async () => {
    let exits = 0;
    let checks = 0;
    const dispose = installParentLivenessGuard({
      env: { [parentPidEnvKey()]: '4242' },
      intervalMs: 5,
      isAlive: () => {
        checks += 1;
        return true;
      },
      exit: () => {
        exits += 1;
      },
    });
    await sleep(30);
    dispose();
    expect(exits).toBe(0);
    expect(checks).toBeGreaterThan(0);
  });

  it('父进程消失 ⇒ 退出一次、停表，回调带父 PID', async () => {
    let exits = 0;
    const detached: number[] = [];
    installParentLivenessGuard({
      env: { [parentPidEnvKey()]: '4242' },
      intervalMs: 5,
      isAlive: () => false,
      exit: () => {
        exits += 1;
      },
      onDetach: (parentPid) => detached.push(parentPid),
    });

    await sleep(40);
    expect(detached).toEqual([4242]);
    expect(exits).toBe(1);
  });
});
