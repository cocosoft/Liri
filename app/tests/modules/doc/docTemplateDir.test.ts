/**
 * 文档模板根目录解析（bundle / compile 两种产物落点）
 *
 * 背景：`TemplateEngine` 原本只认 `import.meta.dir` —— 源码形态下恰好是
 * `app/src/modules/doc/template`（含 `builtin/`）；但 `bun build --compile` 的产物里
 * `import.meta.dir` 指向包内虚拟路径，`.hbs` 不在其中 ⇒ 编译版企业包总会落到
 * `renderFallback`（第十一批端到端构建验证时观察到的既有差异）。
 *
 * 现口径（与 `PromptVersionManager` 的「包内资源根」同构）：按候选顺序取**第一个
 * 真正含有 `builtin/` 的目录** —— 源码 → bundle（`<dir>/modules/doc/template`）→
 * compile（`<exe 目录>/modules/doc/template`）；都不存在则退回第一个候选，
 * 由 `render()` 的 fallback 负责人地降级。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  TemplateEngine,
  resolveDocTemplateDir,
} from '../../../src/modules/doc/template/TemplateEngine.js';

const tempDirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-doc-tpl-'));
  tempDirs.push(dir);
  return dir;
}

/** 造一个"带 builtin/ 的模板根" */
function makeTemplateRoot(): string {
  const root = makeDir();
  mkdirSync(join(root, 'builtin'), { recursive: true });
  writeFileSync(join(root, 'builtin', 'probe.hbs'), '# probe', 'utf-8');
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveDocTemplateDir：候选目录选择', () => {
  it('跳过不含 builtin/ 的候选，取第一个真实可用的', () => {
    const empty = makeDir();
    const usable = makeTemplateRoot();

    expect(
      resolveDocTemplateDir([
        empty,
        join(empty, 'modules/doc/template'),
        usable,
      ])
    ).toBe(usable);
  });

  it('源码形态优先（第一个候选就含 builtin/ 时不再往后找）', () => {
    const source = makeTemplateRoot();
    const packed = makeTemplateRoot();

    expect(resolveDocTemplateDir([source, packed])).toBe(source);
  });

  it('全都不存在时退回第一个候选（不抛，交给 render 的 fallback 降级）', () => {
    const first = join(makeDir(), 'nope');
    const second = join(makeDir(), 'nope2');

    expect(resolveDocTemplateDir([first, second])).toBe(first);
  });
});

describe('TemplateEngine：真实模板能被读到（不走 fallback）', () => {
  it('源码形态下 weekly-report 由 .hbs 渲染，而不是占位输出', () => {
    const engine = new TemplateEngine();
    const rendered = engine.render('weekly-report', {
      projectName: '项目A',
      date: '2026-10-21',
      author: '张三',
      department: '平台组',
      tasks: [],
    });

    // hbs 里写的是 `# 周报 — {{projectName}}`；fallback 写的是 `# 周报模板`
    expect(rendered).toContain('周报 — 项目A');
    expect(rendered).not.toContain('周报模板');
  });
});

describe('构建脚本：模板落点参数', () => {
  it('compile 口径由 build:win:enterprise 显式给 --dist-target=../dist', () => {
    // 只校验 package.json 的接线，防"脚本改了但构建命令没带参数" ⇒ 产物里没有模板
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, '../../../package.json'), 'utf-8')
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts['build:win:enterprise']).toContain(
      '--variant=enterprise --dist-target=../dist'
    );
    // 与 copy-prompts / copy-external-deps 同口径（相对 CWD=app/ 的发布根）
    expect(pkg.scripts['build:win:enterprise']).toContain(
      'copy-prompts.ts --target=../dist'
    );
  });
});
