// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G18（2026-10-11，注册表驱动重构）—— **注册表 ↔ loader 清单一致性**门禁。
 *
 * `factories/builtinToolRegistry` 是构造**唯一来源**；`ToolManagerUtils.buildBuiltinToolLoaders`
 * 通过 `byKey('<key>')` 引用。本门禁锁死两个方向：
 *  ① **loader 侧的键必须存在于注册表** —— 由 `BuiltinToolFactoryKey` 字面量联合在**编译期**保证（此处不重复）；
 *  ② **注册表里的键必须有 loader（或落在显式"未注册"白名单）** —— 防止"表里加了键却忘了注册"
 *     （N-27/N-37 同族缺陷：仅有 schema/构造而无注册点 ⇒ 对模型不可达）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { getBuiltinToolFactoryKeys } from '../../src/tools/utils/ToolManagerUtils';

const LOADERS_SRC = join(
  import.meta.dir,
  '../../src/tools/utils/ToolManagerUtils.ts'
);

/** 去注释（守卫只看代码；注释中引述的 `byKey('…')` 不计） */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** 判据（纯函数，供真实扫描与负向自证共用）：返回**未在 loader 清单中出现**的注册表键 */
function findUnregisteredKeys(
  keys: readonly string[],
  loadersCode: string
): string[] {
  return keys.filter((k) => !loadersCode.includes(`byKey('${k}')`)).sort();
}

/**
 * 显式"**无 loader**"的注册表键白名单（**不得**静默扩张）。
 * `createNotebookEditTool`：P0-2 起与 `createNotebookTool`（NOTEBOOK 门控）重复，已删其无条件注册；
 * 构造入口保留在注册表以维持历史 API 形态（**对模型不可达**，属已知状态）。
 */
const KNOWN_UNREGISTERED_KEYS = ['createNotebookEditTool'] as const;

describe('G18 注册表 ↔ loader 一致性（含门禁自证）', () => {
  const loadersCode = stripComments(readFileSync(LOADERS_SRC, 'utf-8'));

  it('门禁自证（负向夹具）：漏注册的键会被判出 ⇒ 守卫非恒真', () => {
    const fixture = "byKey('createBashTool')";
    expect(
      findUnregisteredKeys(['createBashTool', 'createFooTool'], fixture)
    ).toEqual(['createFooTool']);
  });

  it('注册表键无重复', () => {
    const keys = getBuiltinToolFactoryKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('每个注册表键要么有 loader、要么在显式白名单内', () => {
    expect(
      findUnregisteredKeys(getBuiltinToolFactoryKeys(), loadersCode)
    ).toEqual([...KNOWN_UNREGISTERED_KEYS].sort());
  });
});
