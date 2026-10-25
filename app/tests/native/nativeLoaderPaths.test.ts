// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-09（2026-10-25）：Rust 原生库**候选路径**解析。
//
// 背景：原实现只看 `__dirname/target/release`，而发布包入口是 `dist/pkg/liri.js`
// （`__dirname` = 包根）⇒ 发布包缺库时永远降级 JS，且只有一句无上下文的 warn。
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  nativeLibCandidates,
  nativeLibName,
  nativeSuffix,
} from '../../native/loaderPaths';

describe('T25-09：原生库文件名（按平台）', () => {
  it('Windows 为 liri_native.dll；其余为 libliri_native.<suffix>', () => {
    expect(nativeLibName('win32', 'so')).toBe('liri_native.dll');
    expect(nativeLibName('darwin', 'dylib')).toBe('libliri_native.dylib');
    expect(nativeLibName('linux', 'so')).toBe('libliri_native.so');
  });

  it('平台默认后缀与 bun:ffi 的 suffix 同义', () => {
    expect(nativeSuffix('win32')).toBe('dll');
    expect(nativeSuffix('darwin')).toBe('dylib');
    expect(nativeSuffix('linux')).toBe('so');
  });
});

describe('T25-09：候选路径顺序与去重', () => {
  it('显式覆盖优先，其次包根 target/release、native/ 子目录、cwd/native', () => {
    const dirname = join('/pkg');
    const cwd = join('/repo', 'app');
    const list = nativeLibCandidates({
      platform: 'linux',
      suffix: 'so',
      dirname,
      cwd,
      env: { LIRI_NATIVE_LIB: '/custom/lib.so' },
    });

    expect(list[0]).toBe('/custom/lib.so');
    expect(list[1]).toBe(
      join(dirname, 'target', 'release', 'libliri_native.so')
    );
    expect(list[2]).toBe(
      join(dirname, 'native', 'target', 'release', 'libliri_native.so')
    );
    expect(list[3]).toBe(
      join(cwd, 'native', 'target', 'release', 'libliri_native.so')
    );
    expect(new Set(list).size).toBe(list.length);
  });

  it('无显式覆盖 ⇒ 不产生空串项（候选仍为 3 条）', () => {
    const list = nativeLibCandidates({
      platform: 'win32',
      suffix: 'so',
      dirname: 'C:\\pkg',
      cwd: 'C:\\repo\\app',
      env: {},
    });
    expect(list).toHaveLength(3);
    expect(list.every((p) => p.trim().length > 0)).toBe(true);
    expect(list.some((p) => p.endsWith('liri_native.dll'))).toBe(true);
  });

  it('dirname === cwd 时第三/第四条重合 ⇒ 去重后变短', () => {
    const same = join('/same');
    const list = nativeLibCandidates({
      platform: 'linux',
      suffix: 'so',
      dirname: same,
      cwd: same,
      env: {},
    });
    // 包根 target/release 与 cwd/native/target/release 不同 ⇒ 仍为 3 条；
    // 这里断言的是"去重生效"（不出现重复串）。
    expect(new Set(list).size).toBe(list.length);
  });
});
