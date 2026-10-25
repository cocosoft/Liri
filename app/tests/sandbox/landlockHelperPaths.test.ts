// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-11a（2026-10-25）：`landlock-run` helper 的路径解析 + 随包分发。
//
// 背景：发布链此前从不构建/分发 helper，运行时只认 `LANDLOCK_RUN_HELPER` 或 PATH
// ⇒ Linux 用户开 `bashEnabled` 仍 `capability-unavailable`（安全但不可用）。
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  LANDLOCK_HELPER_BIN_NAME,
  LANDLOCK_HELPER_ENV,
  resolveLandlockHelperCandidates,
  resolveLandlockHelperPath,
} from '../../src/sandbox/landlock/helperPaths';

describe('T25-11a：helper 候选路径', () => {
  it('非 Linux ⇒ 空（该 helper 只对 Linux 有意义）', () => {
    expect(
      resolveLandlockHelperCandidates({
        platform: 'darwin',
        projectDir: '/pkg',
        env: { [LANDLOCK_HELPER_ENV]: '/custom/helper' },
      })
    ).toEqual([]);
    expect(
      resolveLandlockHelperCandidates({
        platform: 'win32',
        projectDir: 'C:\\pkg',
      })
    ).toEqual([]);
  });

  it('顺序：env 显式 → `<PROJECT_DIR>/bin/landlock-run` → PATH 裸名', () => {
    const projectDir = join('/pkg');
    const list = resolveLandlockHelperCandidates({
      platform: 'linux',
      projectDir,
      env: { [LANDLOCK_HELPER_ENV]: '/custom/helper' },
    });
    expect(list[0]).toBe('/custom/helper');
    expect(list[1]).toBe(join(projectDir, 'bin', LANDLOCK_HELPER_BIN_NAME));
    expect(list[2]).toBe(LANDLOCK_HELPER_BIN_NAME);
    expect(new Set(list).size).toBe(list.length);
  });

  it('无 env 覆盖 ⇒ 不含空串（仍为 2 条）', () => {
    const list = resolveLandlockHelperCandidates({
      platform: 'linux',
      projectDir: '/pkg',
      env: {},
    });
    expect(list).toHaveLength(2);
    expect(list.every((p) => p.trim().length > 0)).toBe(true);
  });
});

describe('T25-11a：实际解析', () => {
  const projectDir = join('/pkg');

  it('env 显式优先；即使文件不存在也原样返回（让配置错误可见）', () => {
    expect(
      resolveLandlockHelperPath({
        platform: 'linux',
        projectDir,
        env: { [LANDLOCK_HELPER_ENV]: '/custom/helper' },
        exists: () => false,
      })
    ).toBe('/custom/helper');
  });

  it('随包 `bin/landlock-run` 存在 ⇒ 用它', () => {
    const shipped = join(projectDir, 'bin', LANDLOCK_HELPER_BIN_NAME);
    expect(
      resolveLandlockHelperPath({
        platform: 'linux',
        projectDir,
        env: {},
        exists: (p) => p === shipped,
      })
    ).toBe(shipped);
  });

  it('随包缺失 ⇒ 回退 PATH 裸名（保持旧行为）', () => {
    expect(
      resolveLandlockHelperPath({
        platform: 'linux',
        projectDir,
        env: {},
        exists: () => false,
      })
    ).toBe(LANDLOCK_HELPER_BIN_NAME);
  });

  it('非 Linux ⇒ 裸名（不会被真正调用）', () => {
    expect(
      resolveLandlockHelperPath({
        platform: 'win32',
        projectDir,
        env: {},
        exists: () => true,
      })
    ).toBe(LANDLOCK_HELPER_BIN_NAME);
  });
});
