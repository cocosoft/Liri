/**
 * infra 层边界契约门禁 · **负向自证**（`.trae/specs/infra-layer-boundary-contract.md` §8）
 *
 * 复用纯逻辑（`app/scripts/infraBoundaryCore.ts`），不扫真实文件系统（保测试快）。
 *
 * R1 模块顶层禁止 I/O：
 *  ① 顶层 fs 调用 ⇒ 必报；② 函数体内的同名调用 ⇒ 放行（延迟求值）；
 *  ③ 顶层 `process.env` ⇒ 必报；④ 已登记文件 ⇒ 放行；⑤ 登记失效 ⇒ 提示清理。
 * R2 security / permission 审批编排：
 *  ⑥ 引用 app 模块 ⇒ 必报；⑦ `import type` 放行；⑧ 相对路径同口径 ⇒ 必报；
 *  ⑨ 已登记 (path, specifier) ⇒ 放行；⑩ 引用 infra/core ⇒ 合规。
 * R3 infra 动态导入上层：
 *  ⑪ `import('@modules/tools/…')` / `require('@modules/ai')` ⇒ 必报；
 *  ⑫ 裸包 `import('sharp')` 不算跨层；⑬ 非字面量参数 ⇒ 只提示不判红；
 *  ⑭ 已登记 ⇒ 放行，且消失后提示清理（清零目标）。
 * R4 common / utils 重复导出：
 *  ⑮ 同名声明 ⇒ 必报；⑯ 命名空间内导出也计入；⑰ 已登记 ⇒ 放行；
 *  ⑱ barrel 转出（`export … from`）不算第二份实现。
 * ⑲ 仓库真实白名单可解析且每条都有理由。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SourceFile } from '../../scripts/architectureBoundaryCore.js';
import {
  compareApprovalOrchestration,
  compareCommonUtilsDuplicates,
  compareDynamicInfraToApp,
  compareTopLevelIo,
  findTopLevelIo,
  type InfraBoundaryAllowlist,
} from '../../scripts/infraBoundaryCore.js';

/** 层表夹具：与 `scripts/modules-to-layers.json` 同名同层的最小切片 */
const LAYERS = new Map<string, string>([
  ['permission', 'infra'],
  ['security', 'infra'],
  ['utils', 'infra'],
  ['common', 'infra'],
  ['ai', 'app'],
  ['tools', 'app'],
  ['chat', 'app'],
  ['monitoring', 'infra'],
  ['core', 'core'],
]);

function file(path: string, content: string): SourceFile {
  return { path, content };
}

function allow(
  overrides: Partial<InfraBoundaryAllowlist> = {}
): InfraBoundaryAllowlist {
  return {
    version: 1,
    topLevelIo: [],
    approvalOrchestration: [],
    dynamicInfraToApp: [],
    commonUtilsDuplicates: [],
    ...overrides,
  };
}

describe('R1 模块顶层禁止 I/O', () => {
  it('顶层 fs 调用 ⇒ 必报', () => {
    const hits = findTopLevelIo(
      file(
        'config/load.ts',
        "import { readFileSync } from 'node:fs';\nconst raw = readFileSync('x.json', 'utf-8');\n"
      )
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.raw).toBe('readFileSync');
    expect(hits[0]!.line).toBe(2);
  });

  it('函数体内的同名调用 ⇒ 放行（延迟求值）', () => {
    const hits = findTopLevelIo(
      file(
        'config/load.ts',
        "import { readFileSync } from 'node:fs';\nexport function load() {\n  return readFileSync('x.json', 'utf-8');\n}\n"
      )
    );
    expect(hits).toHaveLength(0);
  });

  it('顶层 process.env ⇒ 必报；对象字面量内同样计入', () => {
    const direct = findTopLevelIo(
      file('utils/env.ts', 'export const env = process.env;\n')
    );
    expect(direct.map((h) => h.raw)).toEqual(['process.env']);

    const inObject = findTopLevelIo(
      file(
        'config/cfg.ts',
        'export const cfg = { dir: process.env.LIRI_HOME };\n'
      )
    );
    expect(inObject.map((h) => h.raw)).toEqual(['process.env']);
  });

  it('已登记 ⇒ 放行；登记失效 ⇒ 提示清理', () => {
    const files = [file('utils/env.ts', 'export const env = process.env;\n')];

    const registered = compareTopLevelIo(
      files,
      allow({
        topLevelIo: [{ path: 'utils/env.ts', reason: '唯一再导出点' }],
      })
    );
    expect(registered.violations).toHaveLength(0);
    expect(registered.checked).toBe(1);

    const dangling = compareTopLevelIo(
      [file('utils/env.ts', 'export const env = {};\n')],
      allow({ topLevelIo: [{ path: 'utils/env.ts', reason: '唯一再导出点' }] })
    );
    expect(dangling.violations).toHaveLength(0);
    expect(dangling.hints.join('\n')).toContain('请清理');
  });

  it('缺少理由的白名单条目本身即违规', () => {
    const result = compareTopLevelIo(
      [file('utils/env.ts', 'export const env = process.env;\n')],
      allow({ topLevelIo: [{ path: 'utils/env.ts', reason: ' ' }] })
    );
    expect(result.violations.join('\n')).toContain('缺少理由');
  });
});

describe('R2 security / permission 不得下沉审批编排', () => {
  it('引用 app 模块 ⇒ 必报', () => {
    const result = compareApprovalOrchestration(
      [file('permission/x.ts', "import { run } from '@modules/chat';\n")],
      LAYERS,
      allow()
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('chat');
  });

  it('import type 放行（编译期契约）', () => {
    const result = compareApprovalOrchestration(
      [
        file(
          'security/y.ts',
          "import type { TaskStatus } from '@modules/tools';\n"
        ),
      ],
      LAYERS,
      allow()
    );
    expect(result.violations).toHaveLength(0);
  });

  it('相对路径与别名同口径 ⇒ 必报（不能换写法绕过）', () => {
    const result = compareApprovalOrchestration(
      [
        file(
          'permission/integrations/z.ts',
          "import { obs } from '../../tools/o';\n"
        ),
      ],
      LAYERS,
      allow()
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('tools');
  });

  it('已登记 (path, specifier) ⇒ 放行', () => {
    const result = compareApprovalOrchestration(
      [file('permission/integrations/z.ts', "require('@modules/tools/o');\n")],
      LAYERS,
      allow({
        approvalOrchestration: [
          {
            path: 'permission/integrations/z.ts',
            specifier: '@modules/tools/o',
            reason: '既有漂移，清零目标',
          },
        ],
      })
    );
    expect(result.violations).toHaveLength(0);
  });

  it('引用 infra / core ⇒ 合规', () => {
    const result = compareApprovalOrchestration(
      [
        file(
          'security/audit/a.ts',
          "import { getLogger } from '@modules/monitoring';\nimport { feature } from '@openliri/kernel';\n"
        ),
      ],
      LAYERS,
      allow()
    );
    expect(result.violations).toHaveLength(0);
    expect(result.checked).toBe(0);
  });
});

describe('R3 infra 动态导入上层', () => {
  it('import() / require() 指向 app 模块 ⇒ 必报', () => {
    const result = compareDynamicInfraToApp(
      [
        file('utils/a.ts', "await import('@modules/tools/x');\n"),
        file('utils/b.ts', "require('@modules/ai');\n"),
      ],
      LAYERS,
      allow()
    );
    expect(result.violations).toHaveLength(2);
    expect(result.checked).toBe(2);
  });

  it('裸包动态导入不算跨层', () => {
    const result = compareDynamicInfraToApp(
      [
        file(
          'media/c.ts',
          "await import('sharp');\nawait import('node:fs');\n"
        ),
      ],
      LAYERS,
      allow()
    );
    expect(result.violations).toHaveLength(0);
  });

  it('非字面量参数 ⇒ 只提示，不判红', () => {
    const result = compareDynamicInfraToApp(
      [file('utils/d.ts', "const name = 'x';\nawait import(name);\n")],
      LAYERS,
      allow()
    );
    expect(result.violations).toHaveLength(0);
    expect(result.hints.join('\n')).toContain('静态不可证');
  });

  it('已登记 ⇒ 放行；消失后提示清理（清零目标）', () => {
    const registered = compareDynamicInfraToApp(
      [file('utils/e.ts', "await import('@modules/ai');\n")],
      LAYERS,
      allow({
        dynamicInfraToApp: [
          { path: 'utils/e.ts', specifier: '@modules/ai', reason: '清零目标' },
        ],
      })
    );
    expect(registered.violations).toHaveLength(0);

    const dangling = compareDynamicInfraToApp(
      [file('utils/e.ts', 'export const x = 1;\n')],
      LAYERS,
      allow({
        dynamicInfraToApp: [
          { path: 'utils/e.ts', specifier: '@modules/ai', reason: '清零目标' },
        ],
      })
    );
    expect(dangling.violations).toHaveLength(0);
    expect(dangling.hints.join('\n')).toContain('请清理');
  });
});

describe('R4 common / utils 重复导出', () => {
  it('同名声明 ⇒ 必报；允许注册豁免', () => {
    const common = [file('common/types.ts', 'export interface Dup { a: 1 }\n')];
    const utils = [file('utils/other.ts', 'export interface Dup { b: 2 }\n')];

    const violating = compareCommonUtilsDuplicates(common, utils, allow());
    expect(violating.violations).toHaveLength(1);
    expect(violating.violations[0]).toContain('Dup');

    const allowed = compareCommonUtilsDuplicates(
      common,
      utils,
      allow({
        commonUtilsDuplicates: [{ name: 'Dup', reason: '归一化盘点待裁定' }],
      })
    );
    expect(allowed.violations).toHaveLength(0);
  });

  it('命名空间内导出也计入（可从模块外触达）', () => {
    const common = [
      file(
        'common/utils.ts',
        'export namespace StringUtils {\n  export function trim(s: string) { return s; }\n}\n'
      ),
    ];
    const utils = [
      file(
        'utils/common.ts',
        'export function trim(s: string) { return s; }\n'
      ),
    ];
    const result = compareCommonUtilsDuplicates(common, utils, allow());
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('trim');
  });

  it('barrel 转出不算第二份实现', () => {
    const common = [
      file(
        'common/index.ts',
        "export { trim } from '@modules/utils/common';\n"
      ),
    ];
    const utils = [
      file(
        'utils/common.ts',
        'export function trim(s: string) { return s; }\n'
      ),
    ];
    const result = compareCommonUtilsDuplicates(common, utils, allow());
    expect(result.violations).toHaveLength(0);
  });
});

describe('仓库真实白名单', () => {
  it('可解析，且每条豁免都有理由', () => {
    const path = resolve(
      import.meta.dir,
      '../../../.trae/architecture/infra-boundary-allowlist.json'
    );
    const raw = JSON.parse(
      readFileSync(path, 'utf-8')
    ) as InfraBoundaryAllowlist;
    expect(raw.version).toBeGreaterThanOrEqual(1);
    const entries = [
      ...raw.topLevelIo,
      ...raw.approvalOrchestration,
      ...raw.dynamicInfraToApp,
      ...raw.commonUtilsDuplicates,
    ];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.reason.trim().length).toBeGreaterThanOrEqual(2);
    }
  });
});
