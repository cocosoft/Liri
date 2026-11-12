// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3（2026-11-12）：写目标识别 + 工作区边界。
 *
 * 口径：下载器族（`iwr` / `Invoke-WebRequest` / `Invoke-RestMethod`）的 `-OutFile`
 * **落在工作区内 ⇒ 允许**（与 `Write` 工具一致）；工作区外 ⇒ 转审批；敏感路径 ⇒ 硬拦。
 */

import { describe, expect, it } from 'bun:test';
import { sep } from 'node:path';
import { extractWriteTargets } from '@openliri/infra/permission/classifiers/write-targets';
import { AutoModeClassifier } from '@openliri/infra/permission/classifiers/AutoModeClassifier';

const classifier = new AutoModeClassifier();

/**
 * 2026-11-12（CI 实证）：用例原先写死 Windows 分隔符 `..\..\outside.txt`，
 * 在 POSIX 上它是一个**普通文件名**（不含目录穿越）⇒ 落点仍在工作区，
 * 断言 `ask` / `outside the workspace` 恒失败（ubuntu/macos 红、windows 绿）。
 * 改为按平台拼分隔符：边界语义与平台一致，三平台同结论。
 */
const OUTSIDE = ['..', '..', 'outside.txt'].join(sep);

async function verdict(command: string): Promise<{
  deny: boolean;
  ask: boolean;
  reason: string;
}> {
  const decision = await classifier.classify('bash', { command }, []);
  return {
    deny: decision.shouldBlock,
    ask: Boolean(decision.requiresApproval),
    reason: decision.reason ?? '',
  };
}

describe('P3：写目标提取', () => {
  it('识别 -OutFile / -Destination / 重定向', () => {
    expect(extractWriteTargets('iwr -Uri .\\a -OutFile .\\out.txt')).toEqual([
      '.\\out.txt',
    ]);
    expect(
      extractWriteTargets('Expand-Archive a.zip -Destination out/')
    ).toEqual(['out/']);
    expect(extractWriteTargets('echo hi > log.txt')).toEqual(['log.txt']);
    expect(extractWriteTargets('echo hi >> log.txt')).toEqual(['log.txt']);
  });

  it('忽略句柄重定向与设备文件', () => {
    expect(extractWriteTargets('cmd 2>&1')).toEqual([]);
    expect(extractWriteTargets('echo hi > /dev/null')).toEqual([]);
  });

  it('无写目标 ⇒ 空数组（调用方保持原档位）', () => {
    expect(extractWriteTargets('git status')).toEqual([]);
    expect(extractWriteTargets('Get-Content a.txt')).toEqual([]);
  });
});

describe('P3：下载器落盘的工作区边界', () => {
  it('工作区内 ⇒ allow', async () => {
    const result = await verdict('iwr -Uri .\\local -OutFile out.txt');
    expect(result.deny).toBe(false);
    expect(result.ask).toBe(false);
    expect(result.reason).toContain('inside the workspace');
  });

  it('工作区外 ⇒ ask', async () => {
    const result = await verdict(`iwr -Uri .\\local -OutFile ${OUTSIDE}`);
    expect(result.deny).toBe(false);
    expect(result.ask).toBe(true);
  });

  it('敏感路径 ⇒ deny（边界判定不得盖过硬拦）', async () => {
    const result = await verdict('iwr -Uri .\\local -OutFile /etc/passwd');
    expect(result.deny).toBe(true);
  });

  it('非下载器命令的写目标口径不变（`Set-Content` 仍 ask）', async () => {
    const result = await verdict('Set-Content -Path a.txt -Value hi');
    expect(result.deny).toBe(false);
    expect(result.ask).toBe(true);
  });

  it('重定向仍 deny，但归因指出目标与边界（P4 归因）', async () => {
    const inside = await verdict('echo hi > out.txt');
    expect(inside.deny).toBe(true);
    expect(inside.reason).toContain('out.txt');
    expect(inside.reason).toContain('inside the workspace');

    const outside = await verdict(`echo hi > ${OUTSIDE}`);
    expect(outside.deny).toBe(true);
    expect(outside.reason).toContain('outside the workspace');
  });
});
