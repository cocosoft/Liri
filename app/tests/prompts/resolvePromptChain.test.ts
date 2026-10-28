/**
 * C-2（2026-10-18）`resolvePrompt()` 六级链 + locale 缓存键 守卫。
 *
 * 六级链（清单 §4 C-2）：
 *   ① 用户覆盖 ~/.pyapp/prompts/<locale>/<id>.md（旧扁平 <id>.md 兼容 P3-10 存量）
 *   → ② 项目覆盖 <workspace>/.liri/prompts/<locale>/<id>.md
 *   → ③ 演化覆盖（promptEvolution 段内置实现，无独立 IO —— 见 PromptVersionManager JSDoc）
 *   → ④ 包内资源 app/prompts/<locale>/sections/<id>.md
 *   → ⑤ 母语回退（zh-TW→zh-CN→en-US）
 *   → ⑥ 内置兜底（调用方 fallback = 内置 compute 结果）。
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  resolvePrompt,
  resolveToolPrompt,
  resolveToolParam,
  getPromptAppendices,
  clearPromptCache,
} from '../../src/services/prompt/PromptVersionManager';
import {
  sectionCache,
  sectionCacheKey,
  setSectionCacheLocale,
  getSectionCacheLocale,
  resolveSystemPromptSections,
  type SystemPromptSection,
} from '@modules/constants';
import { setUserDataDirOverride } from '@modules/environment';

const BUNDLED_IDENTITY = join(
  import.meta.dir,
  '../../prompts/zh-CN/sections/identity.md'
);

let userHome = '';
let projectRoot = '';

beforeAll(() => {
  userHome = mkdtempSync(join(tmpdir(), 'c2-user-'));
  projectRoot = mkdtempSync(join(tmpdir(), 'c2-proj-'));
  setUserDataDirOverride(userHome);
  process.env.LIRI_PROJECT_DIR = projectRoot;
});

afterAll(() => {
  setUserDataDirOverride(null);
  delete process.env.LIRI_PROJECT_DIR;
  setSectionCacheLocale('zh-CN');
  clearPromptCache();
  rmSync(userHome, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

function writeSection(base: string, relParts: string[], text: string): void {
  const full = join(base, ...relParts);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text, 'utf-8');
}

function rmSection(base: string, relParts: string[]): void {
  rmSync(join(base, ...relParts), { force: true });
}

function readBundledIdentity(): string {
  expect(existsSync(BUNDLED_IDENTITY)).toBe(true);
  return readFileSync(BUNDLED_IDENTITY, 'utf-8').trim();
}

describe('C-2 resolvePrompt 六级链', () => {
  it('⑥ 内置兜底：动态段无包内资源 ⇒ 原样返回 fallback（行为零变化）', () => {
    clearPromptCache();
    expect(resolvePrompt('memoryContext', 'FALLBACK')).toBe('FALLBACK');
    expect(getPromptAppendices()).toEqual([]);
  });

  it('① 用户覆盖：<locale>/<id>.md 命中', () => {
    clearPromptCache();
    writeSection(
      userHome,
      ['prompts', 'zh-CN', 'identity.md'],
      'USER_OVERRIDE'
    );
    expect(resolvePrompt('identity', 'FALLBACK')).toBe('USER_OVERRIDE');
  });

  it('① 旧扁平路径兼容：P3-10 存量 ~/.pyapp/prompts/<id>.md 仍生效', () => {
    clearPromptCache();
    rmSection(userHome, ['prompts', 'zh-CN', 'identity.md']);
    writeSection(userHome, ['prompts', 'toolUse.md'], 'LEGACY_FLAT');
    expect(resolvePrompt('toolUse', 'FALLBACK')).toBe('LEGACY_FLAT');
  });

  it('链序 ① > ②：用户与项目同时存在 ⇒ 用户赢', () => {
    clearPromptCache();
    writeSection(userHome, ['prompts', 'zh-CN', 'toolUse.md'], 'FROM_USER');
    writeSection(
      projectRoot,
      ['.liri', 'prompts', 'zh-CN', 'toolUse.md'],
      'FROM_PROJECT'
    );
    expect(resolvePrompt('toolUse', 'FALLBACK')).toBe('FROM_USER');
  });

  it('② 项目覆盖：用户级（locale 子目录与旧扁平）均 miss ⇒ 命中 .liri/prompts/', () => {
    clearPromptCache();
    rmSection(userHome, ['prompts', 'zh-CN', 'toolUse.md']);
    rmSection(userHome, ['prompts', 'toolUse.md']);
    expect(resolvePrompt('toolUse', 'FALLBACK')).toBe('FROM_PROJECT');
  });

  it('④⑤ 包内资源 + 母语回退：zh-TW 缺失 ⇒ 回退 zh-CN 资源', () => {
    clearPromptCache();
    rmSection(userHome, ['prompts', 'zh-CN', 'identity.md']);
    rmSection(projectRoot, ['.liri', 'prompts', 'zh-CN', 'toolUse.md']);
    const bundled = readBundledIdentity();
    expect(resolvePrompt('identity', 'FALLBACK', 'zh-TW')).toBe(bundled);
    // zh-CN 请求同样命中包内资源（文本与内置 diff=0，C-1 守卫背书）
    expect(resolvePrompt('identity', 'FALLBACK')).toBe(bundled);
  });

  it('覆盖后校验：空文件跳过（降级到包内资源）', () => {
    clearPromptCache();
    writeSection(userHome, ['prompts', 'zh-CN', 'identity.md'], '   ');
    expect(resolvePrompt('identity', 'FALLBACK')).toBe(readBundledIdentity());
  });

  it('覆盖后校验：超长文件忽略（降级内置兜底）', () => {
    clearPromptCache();
    // memoryContext 无包内资源 ⇒ 超长覆盖被忽略后落到内置兜底
    writeSection(
      userHome,
      ['prompts', 'zh-CN', 'memoryContext.md'],
      'x'.repeat(70_000)
    );
    expect(resolvePrompt('memoryContext', 'FALLBACK')).toBe('FALLBACK');
  });

  it('manifest 驱动键范围：链外段（strategyExtra）不进链', () => {
    clearPromptCache();
    writeSection(userHome, ['prompts', 'zh-CN', 'strategyExtra.md'], 'HIJACK');
    expect(resolvePrompt('strategyExtra', 'FALLBACK')).toBe('FALLBACK');
  });

  it('30s TTL：命中期间改文件不生效，clearPromptCache 后生效（「热更」同一验收）', () => {
    clearPromptCache();
    const target = join(userHome, 'prompts', 'zh-CN', 'identity.md');
    writeFileSync(target, 'V1', 'utf-8');
    expect(resolvePrompt('identity', 'FALLBACK')).toBe('V1');
    writeFileSync(target, 'V2', 'utf-8');
    expect(resolvePrompt('identity', 'FALLBACK')).toBe('V1'); // TTL 内命中缓存
    clearPromptCache();
    expect(resolvePrompt('identity', 'FALLBACK')).toBe('V2'); // 清缓存即生效
  });
});

describe('C-2 sectionCache locale 键', () => {
  it('key = <locale>:<段名>；空 locale 回退 zh-CN', () => {
    setSectionCacheLocale('en-US');
    expect(sectionCacheKey('toolUse')).toBe('en-US:toolUse');
    setSectionCacheLocale('');
    expect(getSectionCacheLocale()).toBe('zh-CN');
    expect(sectionCacheKey('toolUse')).toBe('zh-CN:toolUse');
  });

  it('同 locale 二次 resolve 命中缓存（命中率不下降）；locale 切换 ⇒ miss 重算', async () => {
    clearPromptCache();
    sectionCache.clear();
    let computes = 0;
    const section: SystemPromptSection = {
      name: 'localeKeyProbe',
      compute: () => {
        computes++;
        return 'PROBE';
      },
      cacheBreak: false,
    };

    setSectionCacheLocale('zh-CN');
    await resolveSystemPromptSections([section]);
    await resolveSystemPromptSections([section]);
    expect(computes).toBe(1); // 同 locale 命中
    expect(sectionCache.get(sectionCacheKey('localeKeyProbe'))).toBe('PROBE');

    setSectionCacheLocale('zh-TW');
    await resolveSystemPromptSections([section]);
    expect(computes).toBe(2); // locale 切换 ⇒ 旧 key 全 miss ⇒ 重算
    expect(sectionCache.get(sectionCacheKey('localeKeyProbe'))).toBe('PROBE');
  });
});

/**
 * C-3：工具提示词与系统段**同一条链**。
 * 依赖全局数据目录 override ⇒ 与 C-2 用例同文件串行执行（避免跨测试文件并发争用单例）。
 */
const BUNDLED_GREP_DESC = join(
  import.meta.dir,
  '../../prompts/zh-CN/tools/GrepTool/getDescription.md'
);

function readBundledGrepDesc(): string {
  expect(existsSync(BUNDLED_GREP_DESC)).toBe(true);
  return readFileSync(BUNDLED_GREP_DESC, 'utf-8').trim();
}

describe('C-3 工具提示词链（与 C-2 同链）', () => {
  // 上一组 locale 键用例会把当前 locale 留在 zh-TW；工具链缺省 locale 取该状态 ⇒ 每组复位
  beforeEach(() => {
    setSectionCacheLocale('zh-CN');
  });

  it('① 用户覆盖：<locale>/tools/<ToolDir>/<Export>.md 生效', () => {
    clearPromptCache();
    writeSection(
      userHome,
      ['prompts', 'zh-CN', 'tools', 'GrepTool', 'getDescription.md'],
      'USER_T'
    );
    expect(resolveToolPrompt('GrepTool', 'getDescription', 'FALLBACK')).toBe(
      'USER_T'
    );
  });

  it('① 旧扁平兼容：tools/<ToolDir>/<Export>.md（无 locale）同样生效', () => {
    clearPromptCache();
    rmSync(join(userHome, 'prompts', 'zh-CN', 'tools', 'GrepTool'), {
      recursive: true,
      force: true,
    });
    writeSection(
      userHome,
      ['prompts', 'tools', 'GrepTool', 'getDescription.md'],
      'FLAT_T'
    );
    expect(resolveToolPrompt('GrepTool', 'getDescription', 'FALLBACK')).toBe(
      'FLAT_T'
    );
  });

  it('链序 ① > ②：用户与项目同时存在 ⇒ 用户赢', () => {
    clearPromptCache();
    writeSection(
      userHome,
      ['prompts', 'zh-CN', 'tools', 'GrepTool', 'getDescription.md'],
      'FROM_USER'
    );
    writeSection(
      projectRoot,
      ['.liri', 'prompts', 'zh-CN', 'tools', 'GrepTool', 'getDescription.md'],
      'FROM_PROJECT'
    );
    expect(resolveToolPrompt('GrepTool', 'getDescription', 'FALLBACK')).toBe(
      'FROM_USER'
    );
  });

  it('② 项目覆盖：用户级全 miss ⇒ 命中 .liri/prompts/<locale>/tools/', () => {
    clearPromptCache();
    rmSync(join(userHome, 'prompts', 'tools'), {
      recursive: true,
      force: true,
    });
    rmSync(join(userHome, 'prompts', 'zh-CN', 'tools'), {
      recursive: true,
      force: true,
    });
    expect(resolveToolPrompt('GrepTool', 'getDescription', 'FALLBACK')).toBe(
      'FROM_PROJECT'
    );
  });

  it('④⑤ 包内资源 + 母语回退：zh-TW 无资源 ⇒ 回退 zh-CN 包内文本', () => {
    clearPromptCache();
    rmSync(join(projectRoot, '.liri'), { recursive: true, force: true });
    expect(
      resolveToolPrompt('GrepTool', 'getDescription', 'FALLBACK', 'zh-TW')
    ).toBe(readBundledGrepDesc());
  });

  it('覆盖后校验：空文件跳过（降级到包内资源）', () => {
    clearPromptCache();
    writeSection(
      userHome,
      ['prompts', 'zh-CN', 'tools', 'GrepTool', 'getDescription.md'],
      '   '
    );
    expect(resolveToolPrompt('GrepTool', 'getDescription', 'FALLBACK')).toBe(
      readBundledGrepDesc()
    );
  });

  it('覆盖后校验：超长文件忽略（降级到包内资源）', () => {
    clearPromptCache();
    writeSection(
      userHome,
      ['prompts', 'zh-CN', 'tools', 'GrepTool', 'getDescription.md'],
      'x'.repeat(70_000)
    );
    expect(resolveToolPrompt('GrepTool', 'getDescription', 'FALLBACK')).toBe(
      readBundledGrepDesc()
    );
  });

  it('30s TTL：命中期间改文件不生效，clearPromptCache 后生效', () => {
    clearPromptCache();
    const rel = ['prompts', 'zh-CN', 'tools', 'GrepTool', 'getDescription.md'];
    writeSection(userHome, rel, 'T1');
    expect(resolveToolPrompt('GrepTool', 'getDescription', 'FALLBACK')).toBe(
      'T1'
    );
    writeSection(userHome, rel, 'T2');
    expect(resolveToolPrompt('GrepTool', 'getDescription', 'FALLBACK')).toBe(
      'T1'
    );
    clearPromptCache();
    expect(resolveToolPrompt('GrepTool', 'getDescription', 'FALLBACK')).toBe(
      'T2'
    );
  });
});

/**
 * C-4：locale 路由（en-US 命中英文资源、未发布 locale 回退 en-US）。
 * 依赖全局数据目录 override ⇒ 同文件串行；每组前清空 override 目录与缓存。
 */
const EN_IDENTITY = join(
  import.meta.dir,
  '../../prompts/en-US/sections/identity.md'
);
const EN_GREP_DESC = join(
  import.meta.dir,
  '../../prompts/en-US/tools/GrepTool/getDescription.md'
);

describe('C-4 locale 路由', () => {
  beforeEach(() => {
    rmSync(join(userHome, 'prompts'), { recursive: true, force: true });
    rmSync(join(projectRoot, '.liri'), { recursive: true, force: true });
    clearPromptCache();
    setSectionCacheLocale('zh-CN');
  });

  it('resolvePrompt：en-US 命中英文资源，zh-CN 命中中文资源', () => {
    const en = readFileSync(EN_IDENTITY, 'utf-8').trim();
    expect(resolvePrompt('identity', 'FALLBACK', 'en-US')).toBe(en);
    expect(resolvePrompt('identity', 'FALLBACK', 'zh-CN')).toBe(
      readBundledIdentity()
    );
  });

  it('resolveToolPrompt：en-US 命中英文资源', () => {
    const en = readFileSync(EN_GREP_DESC, 'utf-8').trim();
    expect(
      resolveToolPrompt('GrepTool', 'getDescription', 'FALLBACK', 'en-US')
    ).toBe(en);
  });

  it('未发布 locale（ja-JP）回退 en-US 资源', () => {
    const en = readFileSync(EN_IDENTITY, 'utf-8').trim();
    expect(resolvePrompt('identity', 'FALLBACK', 'ja-JP')).toBe(en);
  });

  it('工具层 ja-JP 同样回退 en-US', () => {
    const en = readFileSync(EN_GREP_DESC, 'utf-8').trim();
    expect(
      resolveToolPrompt('GrepTool', 'getDescription', 'FALLBACK', 'ja-JP')
    ).toBe(en);
  });
});

/**
 * C-3b：工具**参数描述**（T2 字段级资源 `tool-params.json`）。
 * 与 C-2/C-3 同一隔离环境（`setUserDataDirOverride` 单例）⇒ 同文件串行。
 */
const TOOL_PARAM_RESOURCE = join(
  import.meta.dir,
  '../../prompts/zh-CN/tool-params.json'
);
const EN_TOOL_PARAM_RESOURCE = join(
  import.meta.dir,
  '../../prompts/en-US/tool-params.json'
);

function bundledToolParams(): Record<string, string> {
  const raw = JSON.parse(readFileSync(TOOL_PARAM_RESOURCE, 'utf-8')) as {
    params: Record<string, string>;
  };
  return raw.params;
}

function bundledEnToolParams(): Record<string, string> {
  const raw = JSON.parse(readFileSync(EN_TOOL_PARAM_RESOURCE, 'utf-8')) as {
    params: Record<string, string>;
  };
  return raw.params;
}

describe('C-3b 工具参数资源链', () => {
  beforeEach(() => {
    rmSync(join(userHome, 'prompts'), { recursive: true, force: true });
    rmSync(join(projectRoot, '.liri'), { recursive: true, force: true });
    clearPromptCache();
    setSectionCacheLocale('zh-CN');
  });

  it('包内资源命中：已登记键返回资源值（zh-CN）', () => {
    const params = bundledToolParams();
    expect(resolveToolParam('file_edit', 'file_path', 'FALLBACK')).toBe(
      params['file_edit.file_path']
    );
  });

  it('嵌套键可读：`items` 与 `items.<key>`', () => {
    const params = bundledToolParams();
    expect(
      resolveToolParam('ask_user_question', 'options.items.label', 'FALLBACK')
    ).toBe(params['ask_user_question.options.items.label']);
  });

  it('未登记键 ⇒ 原样返回 fallback（行为零变化）', () => {
    expect(resolveToolParam('no_such_tool', 'x', 'FALLBACK')).toBe('FALLBACK');
  });

  it('en-US 包内资源命中（C-3b 译文批）：locale 切换后返回英文描述', () => {
    setSectionCacheLocale('en-US');
    const zh = bundledToolParams();
    const en = bundledEnToolParams();
    const value = resolveToolParam('file_edit', 'file_path', 'FALLBACK');
    expect(value).toBe(en['file_edit.file_path']);
    expect(value).not.toBe(zh['file_edit.file_path']);
  });

  it('① 用户覆盖生效：<locale>/tool-params.json', () => {
    writeSection(
      userHome,
      ['prompts', 'zh-CN', 'tool-params.json'],
      JSON.stringify({
        schemaVersion: 1,
        locale: 'zh-CN',
        params: { 'file_edit.file_path': 'USER_PARAM' },
      })
    );
    expect(resolveToolParam('file_edit', 'file_path', 'FALLBACK')).toBe(
      'USER_PARAM'
    );
  });

  it('链序 ① > ②：用户与项目同时存在 ⇒ 用户赢', () => {
    writeSection(
      userHome,
      ['prompts', 'zh-CN', 'tool-params.json'],
      JSON.stringify({ params: { 'file_edit.file_path': 'FROM_USER' } })
    );
    writeSection(
      projectRoot,
      ['.liri', 'prompts', 'zh-CN', 'tool-params.json'],
      JSON.stringify({ params: { 'file_edit.file_path': 'FROM_PROJECT' } })
    );
    expect(resolveToolParam('file_edit', 'file_path', 'FALLBACK')).toBe(
      'FROM_USER'
    );
  });

  it('② 项目覆盖：用户级 miss ⇒ 命中 .liri/prompts/<locale>/tool-params.json', () => {
    writeSection(
      projectRoot,
      ['.liri', 'prompts', 'zh-CN', 'tool-params.json'],
      JSON.stringify({ params: { 'file_edit.file_path': 'FROM_PROJECT' } })
    );
    expect(resolveToolParam('file_edit', 'file_path', 'FALLBACK')).toBe(
      'FROM_PROJECT'
    );
  });

  it('坏 JSON ⇒ 视为无资源（回退包内，不抛错）', () => {
    writeSection(userHome, ['prompts', 'zh-CN', 'tool-params.json'], '{oops');
    const params = bundledToolParams();
    expect(resolveToolParam('file_edit', 'file_path', 'FALLBACK')).toBe(
      params['file_edit.file_path']
    );
  });

  it('schema 接线：模型侧参数描述由解析链产出（与资源同源）', async () => {
    const { FileEditTool } =
      await import('../../src/tools/FileEditTool/FileEditTool');
    const info = new FileEditTool().getInfo();
    const params = bundledToolParams();
    for (const p of info.params) {
      expect(resolveToolParam(info.name, p.name, p.description)).toBe(
        params[`${info.name}.${p.name}`]
      );
    }
  });
});
