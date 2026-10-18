/**
 * C-3b（2026-10-18）包内提示词资源根解析守卫。
 *
 * 背景：`bun build --compile` / `build:bundle` 不会自动携带运行时读取的
 * `app/prompts/`，发布链路靠 `scripts/copy-prompts.ts` 复制到
 * `dist/prompts/`（compile）或 `dist/pkg/prompts/`（bundle）。
 * 若资源根推导只认源码路径，则发布包内的提示词译文静默失效（回退内置兜底）。
 *
 * 判据：
 * - 多候选取**第一个真实存在**的目录；
 * - 全部不存在 ⇒ 退回**首候选**（保持既有失败/兜底语义，不抛异常）；
 * - 源码形态下资源根落在 `app/prompts` 且 zh-CN / en-US 的 `tool-params.json` 均可读；
 * - 打包形态（资源与入口同级）可被候选命中。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getPromptResourceRoot,
  resolvePromptResourceRoot,
} from '../../src/services/prompt/PromptVersionManager';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-prompt-root-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('C-3b 提示词资源根解析', () => {
  it('取第一个真实存在的候选（跳过不存在的源码路径）', () => {
    const root = makeTempDir();
    const packed = join(root, 'prompts');
    mkdirSync(packed, { recursive: true });

    const missing = join(root, 'app', 'prompts');
    expect(resolvePromptResourceRoot([missing, packed])).toBe(packed);
  });

  it('全部候选都不存在时退回候选首项（不抛异常）', () => {
    const root = makeTempDir();
    const first = join(root, 'src', 'prompts');
    const second = join(root, 'pkg', 'prompts');

    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
    expect(resolvePromptResourceRoot([first, second])).toBe(first);
  });

  it('源码形态：资源根落在 app/prompts，两种语言的参数描述资源均可读', () => {
    const resourceRoot = getPromptResourceRoot();
    expect(resourceRoot.replaceAll('\\', '/')).toMatch(/\/app\/prompts$/);

    for (const locale of ['zh-CN', 'en-US']) {
      expect(existsSync(join(resourceRoot, locale, 'tool-params.json'))).toBe(
        true
      );
    }
  });

  it('打包形态：资源与入口同级（<root>/prompts）时命中该目录', () => {
    const root = makeTempDir();
    const packed = join(root, 'prompts');
    mkdirSync(join(packed, 'en-US'), { recursive: true });
    writeFileSync(
      join(packed, 'en-US', 'tool-params.json'),
      '{"locale":"en-US"}'
    );

    const unresolvedSource = join(root, 'app', 'src', 'prompts');
    expect(resolvePromptResourceRoot([unresolvedSource, packed])).toBe(packed);
    expect(existsSync(join(packed, 'en-US', 'tool-params.json'))).toBe(true);
  });
});
