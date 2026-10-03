/**
 * 经验自动演化产物读写测试（T-②06，2026-10-03）
 *
 * 覆盖：覆盖层往返 / 归档与回滚 / 上限拒绝 / 版本裁剪 / 技能侧车往返 / 名称越界拒绝 /
 * 侧车不触碰 SKILL.md 本体。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  MAX_OVERLAY_CHARS,
  MAX_OVERLAY_VERSIONS,
  SKILL_EVOLUTION_FILE,
  getOverlayPath,
  getSkillEvolutionPath,
  listPromptEvolutionVersions,
  readPromptEvolutionOverlay,
  readSkillEvolution,
  readSkillEvolutionFromDir,
  rollbackPromptEvolutionOverlay,
  writePromptEvolutionOverlay,
  writeSkillEvolution,
} from '../../src/utils/promptEvolution';

let root: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'evol-'));
  env = {
    ...process.env,
    LIRI_DATA_DIR: join(root, 'data'),
    LIRI_HOME: join(root, 'home'),
  } as NodeJS.ProcessEnv;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('提示覆盖层（prompt-evolution/overlay.md）', () => {
  it('不存在 ⇒ null', () => {
    expect(readPromptEvolutionOverlay(env)).toBeNull();
  });

  it('写入后可读回，且落在受管路径', () => {
    const r = writePromptEvolutionOverlay(' 先确认再删除 ', { env, now: 1000 });
    expect(r).not.toBeNull();
    expect(r!.path).toBe(getOverlayPath(env));
    expect(readPromptEvolutionOverlay(env)).toBe('先确认再删除');
  });

  it('空正文 ⇒ 写入拒绝（不产生文件）', () => {
    expect(writePromptEvolutionOverlay('   ', { env })).toBeNull();
    expect(existsSync(getOverlayPath(env))).toBe(false);
  });

  it('超长正文 ⇒ 写入拒绝；手写超长文件 ⇒ 读取拒绝（不注入）', () => {
    expect(
      writePromptEvolutionOverlay('x'.repeat(MAX_OVERLAY_CHARS + 1), { env })
    ).toBeNull();
    const path = getOverlayPath(env);
    mkdirSync(join(root, 'data', 'prompt-evolution'), { recursive: true });
    writeFileSync(path, 'y'.repeat(MAX_OVERLAY_CHARS + 1), 'utf-8');
    expect(readPromptEvolutionOverlay(env)).toBeNull();
  });

  it('二次写入 ⇒ 归档旧版并可回滚', () => {
    writePromptEvolutionOverlay('v1', { env, now: 1000 });
    const second = writePromptEvolutionOverlay('v2', { env, now: 2000 });
    expect(second!.version).toBe('2000.md');
    expect(listPromptEvolutionVersions(env)).toEqual(['2000.md']);
    expect(readPromptEvolutionOverlay(env)).toBe('v2');

    expect(rollbackPromptEvolutionOverlay('2000.md', env)).toBe(true);
    expect(readPromptEvolutionOverlay(env)).toBe('v1');
  });

  it('回滚参数非法 / 版本不存在 ⇒ false', () => {
    writePromptEvolutionOverlay('v1', { env, now: 1000 });
    expect(rollbackPromptEvolutionOverlay('../etc/passwd', env)).toBe(false);
    expect(rollbackPromptEvolutionOverlay('9999.md', env)).toBe(false);
  });

  it(`版本裁剪：超过 ${MAX_OVERLAY_VERSIONS} 个只保留最新`, () => {
    for (let i = 1; i <= MAX_OVERLAY_VERSIONS + 3; i++) {
      writePromptEvolutionOverlay(`v${i}`, { env, now: 1000 + i });
    }
    const versions = listPromptEvolutionVersions(env);
    expect(versions.length).toBeLessThanOrEqual(MAX_OVERLAY_VERSIONS);
    // 保留的是**最新**若干个（最旧的已被裁剪）
    expect(versions).not.toContain('1001.md');
    expect(versions).toContain(`${1000 + MAX_OVERLAY_VERSIONS + 3}.md`);
  });
});

describe('技能侧车（<name>/.evolution.md）', () => {
  it('写入后可读回；只写侧车，不创建/改写 SKILL.md', () => {
    const r = writeSkillEvolution('demo-skill', '经验：先跑 typecheck', env);
    expect(r).not.toBeNull();
    expect(r!.path).toBe(getSkillEvolutionPath('demo-skill', env));
    expect(readSkillEvolution('demo-skill', env)).toBe('经验：先跑 typecheck');
    expect(existsSync(join(root, 'home', 'skills', 'demo-skill', 'SKILL.md'))).toBe(
      false
    );
    expect(existsSync(join(root, 'home', 'skills', 'demo-skill', SKILL_EVOLUTION_FILE))).toBe(
      true
    );
  });

  it('名称越界（路径穿越）⇒ 拒绝读写', () => {
    expect(getSkillEvolutionPath('../escape', env)).toBeNull();
    expect(writeSkillEvolution('../escape', 'x', env)).toBeNull();
    expect(readSkillEvolution('../escape', env)).toBeNull();
  });

  it('从指定技能目录读取侧车（加载器口径）', () => {
    const skillDir = join(root, 'anywhere', 'sk');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, SKILL_EVOLUTION_FILE), 'dir-sidecar', 'utf-8');
    expect(readSkillEvolutionFromDir(skillDir)).toBe('dir-sidecar');
    expect(readSkillEvolutionFromDir(join(root, 'nope'))).toBeNull();
  });
});
