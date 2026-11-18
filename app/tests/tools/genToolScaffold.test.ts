/**
 * 工具骨架生成器（`app/scripts/gen-tool-scaffold.ts`）单测
 *
 * 只测**纯函数**（模板构造 / 命名归一 / 登记清单），不落盘、不依赖真实工具注册面。
 */
import { describe, expect, test } from 'bun:test';
import {
  buildRegistrationChecklist,
  buildToolScaffold,
  isValidToolName,
  toPascalCase,
} from '../../scripts/gen-tool-scaffold';

describe('toPascalCase', () => {
  test('snake_case ⇒ PascalCase', () => {
    expect(toPascalCase('hello_world')).toBe('HelloWorld');
    expect(toPascalCase('a_b_c')).toBe('ABC');
  });
});

describe('isValidToolName', () => {
  test('接受 [a-z][a-z0-9_]*；拒绝大写 / 连字符 / 数字开头', () => {
    expect(isValidToolName('hello_world')).toBe(true);
    expect(isValidToolName('tool2')).toBe(true);
    expect(isValidToolName('HelloWorld')).toBe(false);
    expect(isValidToolName('hello-world')).toBe(false);
    expect(isValidToolName('2tool')).toBe(false);
  });
});

describe('buildToolScaffold', () => {
  const files = buildToolScaffold({
    name: 'hello_world',
    description: '打招呼',
    dir: 'app/src/tools/HelloWorldTool',
  });

  test('生成工具实现 + schemas 两个文件', () => {
    expect(files.length).toBe(2);
    expect(files.map((f) => f.path.replace(/\\/g, '/'))).toEqual([
      'app/src/tools/HelloWorldTool/HelloWorldTool.ts',
      'app/src/tools/HelloWorldTool/schemas.ts',
    ]);
  });

  test('工具实现：工具名走常量表、继承 BaseTool、出参 schema 显式声明', () => {
    const tool = files[0].content;
    expect(tool).toContain('name = TOOL_NAME_CONSTANTS.hello_world');
    expect(tool).toContain('extends BaseTool');
    expect(tool).toContain('outputJsonSchema');
    expect(tool).toContain("import { HelloWorldInputSchema } from './schemas'");
    expect(tool).toContain('export function createHelloWorldTool');
  });

  test('未实现时明确失败，不返回占位数据（CS04）', () => {
    expect(files[0].content).toContain('尚未实现（骨架）');
    expect(files[0].content).toContain('success: false');
  });

  test('schemas：strictObject + 派生输入类型', () => {
    const schema = files[1].content;
    expect(schema).toContain('z.strictObject({})');
    expect(schema).toContain('export type HelloWorldInput');
  });
});

describe('buildRegistrationChecklist', () => {
  const lines = buildRegistrationChecklist('hello_world', 'system', 'local');

  test('覆盖五个注册面 + 生成物 + 快照 + 门禁', () => {
    const text = lines.join('\n');
    expect(text).toContain('toolNameConstants.ts');
    expect(text).toContain('builtinToolRegistry.ts');
    expect(text).toContain('ToolManagerUtils.ts');
    expect(text).toContain('toolEffects.ts');
    expect(text).toContain('toolCategories.ts');
    expect(text).toContain('bun run gen:toolnames');
    expect(text).toContain('bun run params:export');
    expect(text).toContain('lint:tool-schema');
  });

  test('gen:toolnames 必须先于 TOOL_EFFECTS（顺序依赖）', () => {
    const genIndex = lines.findIndex((l) => l.includes('gen:toolnames'));
    const effectsIndex = lines.findIndex((l) => l.includes('toolEffects.ts'));
    expect(genIndex).toBeGreaterThan(-1);
    expect(effectsIndex).toBeGreaterThan(genIndex);
  });

  test('传参写入类别与效果', () => {
    const text = lines.join('\n');
    expect(text).toContain("hello_world: 'local'");
    expect(text).toContain("hello_world: 'system'");
  });
});
