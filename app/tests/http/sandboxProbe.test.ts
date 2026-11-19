// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * S0（2026-11-17，设置方案 §11.1–§11.4）：命令执行沙箱只读探针。
 *
 * 锁三件事：
 * 1. 判定走 `decideBashLandlockGate` 的**同一实现**（三档语义：master-off / switch-off /
 *    refuse / eval-forced 回退），本模块不另写一套推断；
 * 2. `effective` 不把"helper 文件存在"当成"真隔离"：helper 缺失/不可执行时按
 *    `failClosed` 归为 `refuse` 或 `plain`（Windows 门控不看 helper，这一层负责如实回答）；
 * 3. Windows 自 2026-11-19 起有 `--probe` 执行契约 ⇒ `runnable` 为实测布尔值（通过=ok /
 *    失败=probe-failed 并降级）；helper 缺失 ⇒ `runnable=false` + `helper-missing`
 *    （不把"存在"冒充"可执行"）。
 */
import { describe, expect, it } from 'bun:test';
import type http from 'http';

import { decideBashLandlockGate } from '@modules/tools/bash/bashLandlockExec';

import {
  handleGetSandboxProbe,
  probeCommandSandbox,
  type SandboxProbeDeps,
} from '../../src/infrastructure/http/handlers/sandbox-probe';

/** 用**真实门控函数**组装依赖（探针本身不复制判定逻辑，测试也不复制） */
function makeDeps(overrides: Partial<SandboxProbeDeps> = {}): SandboxProbeDeps {
  return {
    platform: 'linux',
    readConfig: () => ({
      enabled: true,
      bashEnabled: true,
      failClosed: true,
      bashExtraWritablePaths: [],
    }),
    isEvalForced: () => false,
    detectLinux: async () => ({ available: true }),
    detectMac: () => ({ available: false, reason: '非 macOS 平台' }),
    detectWindows: () => ({ available: false, reason: '非 Windows 平台' }),
    linuxHelperPath: () => '/opt/landlock-run',
    helperExists: () => true,
    clearDetectorCaches: () => {},
    decideGate: (input) =>
      decideBashLandlockGate(
        input as Parameters<typeof decideBashLandlockGate>[0]
      ),
    ...overrides,
  };
}

function captureRes(): {
  res: http.ServerResponse;
  captured: { status: number; body: string };
} {
  const captured = { status: 0, body: '' };
  const res = {
    writeHead(status: number) {
      captured.status = status;
    },
    end(body?: string) {
      captured.body = body ?? '';
    },
  } as unknown as http.ServerResponse;
  return { res, captured };
}

describe('S0：沙箱探针（判定同源 / 三档语义）', () => {
  it('总开关关闭 ⇒ effective=off，且**不触发**能力探测', async () => {
    let detected = 0;
    const probe = await probeCommandSandbox({
      deps: makeDeps({
        readConfig: () => ({
          enabled: false,
          bashEnabled: true,
          failClosed: true,
          bashExtraWritablePaths: [],
        }),
        detectLinux: async () => {
          detected += 1;
          return { available: true };
        },
      }),
    });

    expect(probe.effective).toBe('off');
    expect(probe.gate).toEqual({ mode: 'plain', reason: 'master-off' });
    expect(probe.helper.required).toBe(false);
    expect(detected).toBe(0);
  });

  it('enabled=true 但 bashEnabled=false ⇒ effective=plain，仍报告本机能力（供灰条）', async () => {
    const probe = await probeCommandSandbox({
      deps: makeDeps({
        readConfig: () => ({
          enabled: true,
          bashEnabled: false,
          failClosed: false,
          bashExtraWritablePaths: [],
        }),
      }),
    });

    expect(probe.gate).toEqual({ mode: 'plain', reason: 'switch-off' });
    expect(probe.effective).toBe('plain');
    expect(probe.helper.required).toBe(false);
    expect(probe.helper.runnable).toBe(true);
  });

  it('Linux 能力可用 ⇒ isolated，helper 三态如实（present/runnable/ok）', async () => {
    const probe = await probeCommandSandbox({ deps: makeDeps() });

    expect(probe.gate).toEqual({ mode: 'landlock', reason: 'enabled' });
    expect(probe.effective).toBe('isolated');
    expect(probe.helper).toMatchObject({
      kind: 'landlock-run',
      required: true,
      present: true,
      runnable: true,
      reasonCode: 'ok',
    });
    expect(probe.coverage).toEqual({
      write: true,
      read: false,
      network: false,
    });
    expect(probe.affectedTools).toEqual(['bash', 'powershell', 'code_run']);
  });

  it('Linux helper 缺失 ⇒ 门控 refuse，reasonCode=helper-missing + 可排障 detail', async () => {
    const probe = await probeCommandSandbox({
      deps: makeDeps({
        detectLinux: async () => ({
          available: false,
          reason: 'helper-missing',
        }),
        helperExists: () => false,
        linuxHelperPath: () => '/opt/landlock-run',
      }),
    });

    expect(probe.gate.mode).toBe('refuse');
    expect(probe.gate.reason).toBe('capability-unavailable');
    expect(probe.effective).toBe('refuse');
    expect(probe.helper).toMatchObject({
      present: false,
      runnable: false,
      reasonCode: 'helper-missing',
      detail: 'helper-missing',
    });
    expect(probe.notes.join('\n')).toContain('拒绝执行');
  });

  it('Linux 未知能力原因 ⇒ 机读码归 probe-failed（不把自由文本当码）', async () => {
    const probe = await probeCommandSandbox({
      deps: makeDeps({
        detectLinux: async () => ({
          available: false,
          reason: 'some-new-reason',
        }),
      }),
    });
    expect(probe.helper.reasonCode).toBe('probe-failed');
  });

  it('评测期强制 + 能力不可用 ⇒ 回退 plain（绝不 refuse），notes 明示', async () => {
    const probe = await probeCommandSandbox({
      deps: makeDeps({
        isEvalForced: () => true,
        detectLinux: async () => ({
          available: false,
          reason: 'helper-missing',
        }),
      }),
    });

    expect(probe.gate).toEqual({
      mode: 'plain',
      reason: 'eval-forced-fallback',
    });
    expect(probe.effective).toBe('plain');
    expect(probe.evalForced).toBe(true);
    expect(probe.notes.join('\n')).toContain('评测期强制');
  });

  // 2026-11-19：Windows helper 补齐 `--probe` 后改为**实测**（不再固定 runnable=null）。
  it('Windows：helper --probe 通过 ⇒ isolated + runnable=true + ok', async () => {
    const probe = await probeCommandSandbox({
      deps: makeDeps({
        platform: 'win32',
        detectWindows: () => ({
          available: true,
          present: true,
          runnable: true,
          reasonCode: 'ok',
          path: 'C:/tools/win-sandbox-run.exe',
        }),
      }),
    });

    expect(probe.gate.mode).toBe('windows-low-il');
    expect(probe.effective).toBe('isolated');
    expect(probe.helper).toMatchObject({
      kind: 'win-sandbox-run',
      present: true,
      runnable: true,
      reasonCode: 'ok',
    });
  });

  it('Windows：helper 存在但 --probe 失败 ⇒ present=true/runnable=false 且降级（failClosed=false）', async () => {
    const base = makeDeps({
      platform: 'win32',
      detectWindows: () => ({
        available: true,
        present: true,
        runnable: false,
        reasonCode: 'probe-failed',
        reason: 'helper --probe 未通过（probe-failed）',
        path: 'C:/tools/win-sandbox-run.exe',
      }),
    });
    const probe = await probeCommandSandbox({
      deps: {
        ...base,
        readConfig: () => ({
          enabled: true,
          bashEnabled: true,
          failClosed: false,
          bashExtraWritablePaths: [],
        }),
      },
    });

    expect(probe.helper).toMatchObject({
      present: true,
      runnable: false,
      reasonCode: 'probe-failed',
    });
    expect(probe.effective).toBe('plain');
    expect(probe.notes.join('\n')).toContain('已**降级为普通执行**');
  });

  it('Windows helper 缺失 ⇒ failClosed=false 降级 plain；true ⇒ refuse', async () => {
    const missingWin = () =>
      makeDeps({
        platform: 'win32',
        detectWindows: () => ({ available: false, reason: '未找到 helper' }),
      });

    const degraded = await probeCommandSandbox({
      deps: {
        ...missingWin(),
        readConfig: () => ({
          enabled: true,
          bashEnabled: true,
          failClosed: false,
          bashExtraWritablePaths: [],
        }),
      },
    });
    expect(degraded.gate.mode).toBe('windows-low-il');
    expect(degraded.effective).toBe('plain');
    expect(degraded.helper.present).toBe(false);

    const refused = await probeCommandSandbox({ deps: missingWin() });
    expect(refused.effective).toBe('refuse');
    expect(refused.notes.join('\n')).toContain('拒绝执行');
  });

  it('macOS 缺 sandbox-exec ⇒ 门控直接 refuse（与 Linux 同口径）', async () => {
    const probe = await probeCommandSandbox({
      deps: makeDeps({
        platform: 'darwin',
        detectMac: () => ({
          available: false,
          reason: '未找到 /usr/bin/sandbox-exec',
        }),
      }),
    });

    expect(probe.gate.mode).toBe('refuse');
    expect(probe.effective).toBe('refuse');
    expect(probe.helper).toMatchObject({
      kind: 'sandbox-exec',
      present: false,
      reasonCode: 'not-found',
    });
  });

  it('force=true 才清探测器缓存（手动重测语义）', async () => {
    let cleared = 0;
    const deps = makeDeps({
      clearDetectorCaches: () => {
        cleared += 1;
      },
    });

    await probeCommandSandbox({ deps });
    expect(cleared).toBe(0);
    await probeCommandSandbox({ deps, force: true });
    expect(cleared).toBe(1);
  });
});

describe('S0：GET /v1/diagnostics/sandbox/probe（契约）', () => {
  it('返回 200 + 探针形状（本机真实探测）', async () => {
    const { res, captured } = captureRes();

    await handleGetSandboxProbe(
      { url: '/v1/diagnostics/sandbox/probe' } as http.IncomingMessage,
      res
    );

    expect(captured.status).toBe(200);
    const body = JSON.parse(captured.body) as {
      platform: string;
      effective: string;
      coverage: unknown;
      affectedTools: string[];
      config: unknown;
    };
    expect(body.platform).toBe(process.platform);
    expect(['off', 'plain', 'isolated', 'refuse']).toContain(body.effective);
    expect(body.coverage).toEqual({ write: true, read: false, network: false });
    expect(body.affectedTools).toEqual(['bash', 'powershell', 'code_run']);
    expect(body.config).toBeTruthy();
  });
});
