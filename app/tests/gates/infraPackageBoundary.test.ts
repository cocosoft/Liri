/**
 * R6：infra 物理包边界（2026-11-01）。
 *
 * 动机（实证）：把 `external` 真迁到 `packages/infra` 后，`lint:arch` R00-001 与 R1–R5
 * 都**不再扫描**该目录 —— 在包里写 `import … from '@modules/chat/…'` 也能全绿。
 * R6 把这条边界显式化，并覆盖"相对路径逃逸出包"（绕过别名的最短路径）。
 *
 * 本用例只测纯函数；端到端（`INFRA_PACKAGE_SRC` 指向临时包根）已在开发期人工负向自证。
 */
import { describe, expect, it } from 'bun:test';
import {
  compareInfraPackageBoundary,
  type SourceFile,
} from '../../scripts/infraBoundaryCore';

const LAYERS = new Map<string, string>([
  ['external', 'infra'],
  ['config', 'infra'],
  ['chat', 'app'],
  ['core', 'core'],
  ['query', 'service'],
]);

function pkgFile(path: string, content: string): SourceFile {
  return { path, content };
}

function run(packageFiles: SourceFile[], appFiles: SourceFile[] = []) {
  return compareInfraPackageBoundary({
    packageFiles,
    appFiles,
    layerOf: LAYERS,
  });
}

describe('R6 infra 物理包边界', () => {
  it('包内依赖 app 层 ⇒ 违规；依赖同层 infra ⇒ 合规', () => {
    const report = run([
      pkgFile(
        'external/a.ts',
        "import { ChatManager } from '@modules/chat/ChatManager';\nimport { configManager } from '@openliri/infra/config';\nexport const x = [ChatManager, configManager];\n"
      ),
    ]);
    expect(report.rule).toBe('R6');
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain('app 层模块 @modules/chat');
  });

  it('包内依赖 core 层模块同样违规（core 只依赖 core）', () => {
    const report = run([
      pkgFile(
        'external/b.ts',
        // 旧别名拆两段拼接：`lint:kernel-alias` 是**纯字符串**扫描（连测试夹具也算），
        // 直接写整串会让该门禁永远红（2026-11-01 P7 发现）；拼接后夹具内容逐字不变。
        "import { y } from '@modules/" + "core';\nexport const z = y;\n"
      ),
    ]);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain('core 层模块 @modules/core');
  });

  it('包内依赖未登记模块 ⇒ 违规（不允许沉默放行）', () => {
    const report = run([
      pkgFile(
        'external/c.ts',
        "import { q } from '@modules/nope';\nexport const w = q;\n"
      ),
    ]);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]).toContain('未登记模块 @modules/nope');
  });

  it('相对路径逃逸出包 ⇒ 违规；包内相对引用 ⇒ 合规', () => {
    const escape = run([
      pkgFile(
        'external/d.ts',
        "import { c } from '../../../../app/src/chat/ChatManager';\nexport const v = c;\n"
      ),
    ]);
    expect(escape.violations).toHaveLength(1);
    expect(escape.violations[0]).toContain('逃逸出 infra 包');

    const inside = run([
      pkgFile(
        'external/e.ts',
        "import { s } from './sqlite3';\nexport const t = s;\n"
      ),
    ]);
    expect(inside.violations).toHaveLength(0);
  });

  it('app 侧引用 @openliri/infra/<m>：已登记 infra ⇒ 合规；未登记或 core 引用 ⇒ 违规', () => {
    const ok = run(
      [],
      [
        pkgFile(
          'chat/a.ts',
          "import { db } from '@openliri/infra/external';\nexport const x = db;\n"
        ),
      ]
    );
    expect(ok.violations).toHaveLength(0);

    const unknown = run(
      [],
      [
        pkgFile(
          'chat/b.ts',
          "import { y } from '@openliri/infra/nope';\nexport const z = y;\n"
        ),
      ]
    );
    expect(unknown.violations).toHaveLength(1);
    expect(unknown.violations[0]).toContain('未登记为 infra');

    const core = run(
      [],
      [
        pkgFile(
          'core/c.ts',
          "import { w } from '@openliri/infra/external';\nexport const v = w;\n"
        ),
      ]
    );
    expect(core.violations).toHaveLength(1);
    expect(core.violations[0]).toContain('core 层不得依赖 infra 包');
  });
});
