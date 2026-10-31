/**
 * 架构边界门禁 · **负向自证**（演进方案 W2 分层循环 / W4 工具面单一事实源）
 *
 * 复用纯逻辑（`app/scripts/architectureBoundaryCore.ts`），不扫真实文件系统（保测试快）。
 *
 * W2 断言：
 *  ① 运行时依赖 L2/L3 未登记 ⇒ 必报；
 *  ② 已登记例外（path + specifier 精确匹配）⇒ 通过；
 *  ③ `import type` ⇒ 放行（编译期契约）；
 *  ④ 相对路径写法（`../tasks/x`）与别名同一口径 ⇒ 同样必报（不能靠换写法绕过）；
 *  ⑤ 多行 import 能正确识别；
 *  ⑥ 注释里的 import 不算证据；
 *  ⑦ 例外理由为空 ⇒ 必报。
 *
 * W4 断言：
 *  ⑧ 工具实现内 `feature('TOOL_*')` ⇒ 必报；
 *  ⑨ 已登记豁免目录（`tools/sidecar`）⇒ 放行；
 *  ⑩ 注释里的 `feature('TOOL_*')` 不算（说明性文字不应触发门禁）；
 *  ⑪ 单文件豁免（`exemptFiles`，2026-10-31）只认**精确路径**，且理由为空必报。
 */
import { describe, expect, it } from 'bun:test';

import {
  compareLoopBoundary,
  compareToolSelfChecks,
  parseImports,
  type ArchitectureBoundaries,
  type SourceFile,
} from '../../scripts/architectureBoundaryCore.js';

function makeConfig(): ArchitectureBoundaries {
  return {
    version: 1,
    loopBoundary: {
      targets: ['chat', 'tasks', 'workspace'],
      exceptions: [
        {
          path: 'query/TAORLoop.ts',
          specifier: '@modules/tasks',
          reason: '纯文案模板',
        },
      ],
    },
    toolSelfCheck: {
      exemptDirs: [{ dir: 'tools/sidecar', reason: '旁路进程生命周期' }],
    },
  };
}

function refsOf(path: string, content: string) {
  return parseImports({ path, content });
}

describe('W2 分层循环边界', () => {
  it('未登记的运行时跨层依赖必报', () => {
    // 同一 specifier 但在**未登记**的文件里 ⇒ 例外按 path + specifier 精确匹配，不放行
    const refs = refsOf(
      'query/taor/roundProgress.ts',
      "import { taskOrchestrator } from '@modules/tasks';\n"
    );
    const result = compareLoopBoundary(refs, makeConfig().loopBoundary);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('@modules/tasks');
  });

  it('已登记例外（path + specifier 精确匹配）通过', () => {
    const refs = refsOf(
      'query/TAORLoop.ts',
      "import { CONTINUATION_TEMPLATES } from '@modules/tasks';\n"
    );
    const result = compareLoopBoundary(refs, makeConfig().loopBoundary);
    expect(result.violations).toHaveLength(0);
    expect(result.checked).toBe(1);
  });

  it('import type 放行（编译期契约）', () => {
    const refs = refsOf(
      'query/TAORLoop.ts',
      "import type { TaskStatus } from '@modules/tasks';\n"
    );
    const result = compareLoopBoundary(refs, makeConfig().loopBoundary);
    expect(result.violations).toHaveLength(0);
    expect(result.checked).toBe(0);
  });

  it('相对路径与别名同一口径 ⇒ 不能靠换写法绕过', () => {
    const refs = refsOf(
      'query/taor/helpers.ts',
      "import { x } from '../../tasks/goal/goalTemplates';\n"
    );
    const result = compareLoopBoundary(refs, makeConfig().loopBoundary);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('../../tasks/goal/goalTemplates');
  });

  it('多行 import 能识别', () => {
    const refs = refsOf(
      'agent/x.ts',
      "import {\n  a,\n  b,\n} from '@modules/chat';\n"
    );
    const result = compareLoopBoundary(refs, makeConfig().loopBoundary);
    expect(result.violations).toHaveLength(1);
  });

  it('注释里的 import 不算证据', () => {
    const refs = refsOf(
      'agent/x.ts',
      "// import { a } from '@modules/chat';\n/* import { b } from '@modules/tasks'; */\nexport const ok = 1;\n"
    );
    expect(refs).toHaveLength(0);
  });

  it('例外理由为空 ⇒ 必报', () => {
    const config = makeConfig();
    config.loopBoundary.exceptions = [
      { path: 'query/TAORLoop.ts', specifier: '@modules/tasks', reason: ' ' },
    ];
    const result = compareLoopBoundary([], config.loopBoundary);
    expect(result.violations.some((v) => v.includes('例外缺少理由'))).toBe(
      true
    );
  });
});

describe('W4 工具面单一事实源', () => {
  const file = (path: string, content: string): SourceFile => ({
    path,
    content,
  });

  it('工具实现内 feature(TOOL_*) ⇒ 必报', () => {
    const result = compareToolSelfChecks(
      [file('tools/SomeTool.ts', "if (!feature('TOOL_SOME')) return null;\n")],
      makeConfig().toolSelfCheck
    );
    expect(result.violations).toHaveLength(1);
    expect(result.checked).toBe(1);
  });

  it('已登记豁免目录（tools/sidecar）放行', () => {
    const result = compareToolSelfChecks(
      [
        file(
          'tools/sidecar/toolSidecarLifecycle.ts',
          "export const on = () => feature('TOOL_SIDECAR_LSP');\n"
        ),
      ],
      makeConfig().toolSelfCheck
    );
    expect(result.violations).toHaveLength(0);
    expect(result.checked).toBe(1);
  });

  it('注释里的 feature(TOOL_*) 不算', () => {
    const result = compareToolSelfChecks(
      [file('tools/SomeTool.ts', "// 旧写法 feature('TOOL_X') 已移除\n")],
      makeConfig().toolSelfCheck
    );
    expect(result.violations).toHaveLength(0);
    expect(result.checked).toBe(0);
  });

  it('豁免目录理由为空 ⇒ 必报', () => {
    const config = makeConfig();
    config.toolSelfCheck.exemptDirs = [{ dir: 'tools/sidecar', reason: '' }];
    const result = compareToolSelfChecks([], config.toolSelfCheck);
    expect(result.violations.some((v) => v.includes('缺少理由'))).toBe(true);
  });

  it('已登记豁免文件（精确路径）放行', () => {
    const config = makeConfig();
    config.toolSelfCheck.exemptFiles = [
      { path: 'tools/toolCategories.ts', reason: '可见性单一内核' },
    ];
    const result = compareToolSelfChecks(
      [file('tools/toolCategories.ts', "if (!feature('TOOL_X')) return;\n")],
      config.toolSelfCheck
    );
    expect(result.violations).toHaveLength(0);
    expect(result.checked).toBe(1);
  });

  it('单文件豁免只认精确路径（同目录其他文件仍必报）', () => {
    const config = makeConfig();
    config.toolSelfCheck.exemptFiles = [
      { path: 'tools/toolCategories.ts', reason: '可见性单一内核' },
    ];
    const result = compareToolSelfChecks(
      [
        file('tools/Other.ts', "if (!feature('TOOL_X')) return;\n"),
        file('tools/toolCategories.ts', "if (!feature('TOOL_Y')) return;\n"),
      ],
      config.toolSelfCheck
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('tools/Other.ts');
  });

  it('豁免文件理由为空 ⇒ 必报', () => {
    const config = makeConfig();
    config.toolSelfCheck.exemptFiles = [
      { path: 'tools/toolCategories.ts', reason: ' ' },
    ];
    const result = compareToolSelfChecks([], config.toolSelfCheck);
    expect(result.violations.some((v) => v.includes('豁免文件缺少理由'))).toBe(
      true
    );
  });
});
