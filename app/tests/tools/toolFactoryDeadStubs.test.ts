// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * S3-2（G19 / CD05–CD06，2026-10-11）—— `ToolFactory` 4 个死桩**入口摘除 + 实现删除**守卫。
 *
 * 历程：步骤①（摘 `buildBuiltinToolLoaders` 的条件注册入口，行为零变更）→ 步骤②（删实现体 +
 * `WORKFLOW_SCRIPTS`/`ENABLE_WORKFLOWS` 死特性位 + `CORE_MODULES.md` 文档条目）。
 * 依据：`.trae/specs/workflow-definition-externalization.md` D5「V-3 选删除」。
 *
 * 两个断言面：
 *  ① **静态**：注册面源文件不再引用这 4 个方法（防"入口悄悄回流"）；
 *  ② **运行期**：这 4 个工厂方法**已从 `ToolFactory` 移除**，且两个死特性位不再存在
 *     （防"删了又被加回来"）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { ToolFactory } from '../../src/tools/ToolFactory.js';
import {
  getAllBuiltinToolLoaders,
  loadTools,
} from '../../src/tools/utils/ToolManagerUtils.js';
import { FEATURE_FLAGS } from '../../src/core/featureFlags.js';

const LOADERS_SRC = join(
  import.meta.dir,
  '../../src/tools/utils/ToolManagerUtils.ts'
);

/** 去注释（守卫只看代码，不受注释中的"回滚说明"引述影响） */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const DEAD_STUBS = [
  'createRemoteTriggerTool',
  'createSendUserFileTool',
  'createSnipTool',
  'createWorkflowTool',
] as const;

/** 已删除的死特性位（步骤② 清理） */
const DEAD_FLAGS = ['WORKFLOW_SCRIPTS', 'ENABLE_WORKFLOWS'] as const;

/** 判据（纯函数，供真实扫描与**负向自证**共用）：返回注册面里仍引用的死桩方法名 */
function findDeadStubRegistrations(code: string): string[] {
  return DEAD_STUBS.filter((m) => code.includes(m));
}

describe('S3-2：ToolFactory 死桩入口已摘 + 实现已删（G19/CD05–CD06）', () => {
  const loadersCode = stripComments(readFileSync(LOADERS_SRC, 'utf-8'));

  it('门禁自证（负向夹具）：注册面含死桩会被判违规 ⇒ 守卫非恒真', () => {
    const bad = stripComments(
      'createToolLoader(ToolFactory.prototype.createSnipTool),\n' +
        'createToolLoader(ToolFactory.prototype.createWorkflowTool),\n'
    );
    expect(findDeadStubRegistrations(bad)).toEqual([
      'createSnipTool',
      'createWorkflowTool',
    ]);
  });

  it('静态：注册面不再引用任何死桩方法', () => {
    expect(findDeadStubRegistrations(loadersCode)).toEqual([]);
  });

  it('运行期：4 个死桩方法已从 ToolFactory 移除（步骤②）', () => {
    const factory = new ToolFactory() as unknown as Record<string, unknown>;
    for (const m of DEAD_STUBS) {
      expect(typeof factory[m]).toBe('undefined');
    }
  });

  it('运行期：`WORKFLOW_SCRIPTS`/`ENABLE_WORKFLOWS` 死特性位已删（防回流）', () => {
    for (const f of DEAD_FLAGS) {
      expect(Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, f)).toBe(
        false
      );
    }
  });

  it('摘除后全量加载面仍能产出工具（防"摘多了"）', () => {
    const tools = loadTools(new ToolFactory(), getAllBuiltinToolLoaders());
    expect(tools.length).toBeGreaterThan(50);
  });
});
