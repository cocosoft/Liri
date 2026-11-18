// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 特征化测试：`projectContext` 段落（P3-2 拆分前置）。
 *
 * 目的：在把该段落里的「阶段信息」「最近摘要」「文件列表」三段原样外移为纯辅助之前，
 * 先用断言锁住**段落级**可观测输出（null 条件、正文、摘要小节、文件列表、4000 字截断）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setCurrentSessionContext } from '@openliri/service/services/prompt/MemoryPromptProvider';
import { BUILTIN_SECTIONS } from '../../src/context/promptSections/builtinSections';

let dataDir: string;
const prevDataDir = process.env.LIRI_DATA_DIR;

function projDir(projectId = 'proj-ctx'): string {
  return join(dataDir, 'projects', projectId);
}

function seedProjectContext(content: string, projectId = 'proj-ctx'): string {
  mkdirSync(projDir(projectId), { recursive: true });
  writeFileSync(
    join(projDir(projectId), 'project-context.md'),
    content,
    'utf-8'
  );
  return projectId;
}

async function computeSection(): Promise<string | null> {
  return (await BUILTIN_SECTIONS.projectContext.compute()) as string | null;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pyapp-projectctx-'));
  process.env.LIRI_DATA_DIR = dataDir;
  setCurrentSessionContext(null);
});

afterEach(() => {
  setCurrentSessionContext(null);
  if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevDataDir;
  try {
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    /* 临时目录清理失败不影响测试结论 */
  }
});

describe('projectContext 段落既有行为', () => {
  it('无会话上下文 / 无 projectId ⇒ null', async () => {
    expect(await computeSection()).toBeNull();
    setCurrentSessionContext({ projectId: undefined } as never);
    expect(await computeSection()).toBeNull();
  });

  it('project-context.md 不存在 ⇒ null', async () => {
    setCurrentSessionContext({ projectId: 'proj-missing' } as never);
    expect(await computeSection()).toBeNull();
  });

  it('正文为空白 ⇒ null', async () => {
    seedProjectContext('   \n  ');
    setCurrentSessionContext({ projectId: 'proj-ctx' } as never);
    expect(await computeSection()).toBeNull();
  });

  it('正常 ⇒ 含项目上下文正文、约定与项目 ID', async () => {
    const id = seedProjectContext('这是一个测试项目');
    setCurrentSessionContext({ projectId: id } as never);

    const out = await computeSection();
    expect(out).toContain('## 项目上下文');
    expect(out).toContain('这是一个测试项目');
    expect(out).toContain('**文件组织约定**');
    expect(out).toContain(`\`${id}\``);
  });

  it('超长正文 ⇒ 触发 4000 字截断并带标记', async () => {
    const id = seedProjectContext('X'.repeat(6000));
    setCurrentSessionContext({ projectId: id } as never);

    const out = await computeSection();
    expect(out).toContain('*(上下文已截断)*');
    expect(String(out).length).toBeLessThan(6000);
  });

  it('summaries.json 的决策 / 阶段性小结 ⇒ 各自成节', async () => {
    const id = seedProjectContext('正文');
    writeFileSync(
      join(projDir(id), 'summaries.json'),
      JSON.stringify([
        { sessionId: 's1', summary: '总结一', messageCount: 3 },
        { sessionId: 's2', decision: '采用方案 A', messageCount: 4 },
      ]),
      'utf-8'
    );
    setCurrentSessionContext({ projectId: id } as never);

    const out = await computeSection();
    expect(out).toContain('## 最近决策');
    expect(out).toContain('采用方案 A');
  });

  it('文件夹路径有效 ⇒ 列出文件（带大小）与子目录', async () => {
    const id = seedProjectContext('正文');
    const sandbox = join(dataDir, 'sandbox');
    mkdirSync(join(sandbox, '00_input'), { recursive: true });
    writeFileSync(join(sandbox, 'a.txt'), 'hello', 'utf-8');
    writeFileSync(
      join(projDir(id), 'project-context.md'),
      `正文\n\n**文件夹**: ${sandbox}`,
      'utf-8'
    );
    setCurrentSessionContext({ projectId: id } as never);

    const out = await computeSection();
    expect(out).toContain('**项目文件**');
    expect(out).toContain('00_input/');
    expect(out).toContain('a.txt (5B)');
  });

  it('文件夹路径不存在 ⇒ 不出现文件列表（其余段落照常）', async () => {
    const id = seedProjectContext(
      `正文\n\n**文件夹**: ${join(dataDir, 'nope')}`
    );
    setCurrentSessionContext({ projectId: id } as never);

    const out = await computeSection();
    expect(out).toContain('## 项目上下文');
    expect(out).not.toContain('**项目文件**');
    expect(existsSync(join(dataDir, 'nope'))).toBe(false);
  });
});
