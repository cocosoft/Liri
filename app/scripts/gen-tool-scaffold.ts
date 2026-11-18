/**
 * gen-tool-scaffold.ts — **内置工具骨架生成器**（#4 单点试点：只做工具）
 *
 * 用法（cwd = `app/`）：
 *   bun run gen:tool-scaffold hello_world --desc "打招呼"           # 预览（默认不写盘）
 *   bun run gen:tool-scaffold hello_world --desc "打招呼" --write   # 落盘
 *
 * **为什么只生成"工具自己的两个文件"**：
 * 注册面（`toolNameConstants` / `builtinToolRegistry` / `ToolManagerUtils` /
 * `TOOL_EFFECTS` / `TOOL_CATEGORY_ENTRIES`）之间存在**顺序依赖**（`TOOL_EFFECTS` 的键类型
 * 来自 `gen:toolnames` 的产物，产物又来自"真实实例化已注册的工具"）——自动改写这些文件
 * 会制造**第二套真相**（CS01），且改错时 `typecheck` 先红、定位成本远高于照着清单点一遍。
 * 故生成器输出**精确登记清单**（路径 + 待插入那一行的字面形状）与**门禁命令**，不代改注册面。
 *
 * **不生成假实现**（CS04）：`execute()` 未实现前**明确返回失败**，不返回占位数据。
 *
 * 事实口径见：
 * - `app/src/tools/BaseTool.ts`（基类契约）
 * - `app/src/tools/factories/builtinToolRegistry.ts`（工厂表）
 * - `app/src/tools/utils/ToolManagerUtils.ts`（loader 清单）
 * - `app/src/tools/toolEffects.ts`（效果 / 能力唯一真源）
 * - `app/src/tools/toolCategories.ts`（任务白名单归类的依据）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_SCAFFOLD_APP_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..'
);
const TOOL_SCAFFOLD_USAGE = [
  '用法：bun run gen:tool-scaffold <snake_case 工具名> [选项]',
  '  --desc <文本>      工具描述（必填）',
  '  --write            真正落盘（缺省仅预览）',
  '  --dir <目录>       工具目录（缺省 app/src/tools/<XxxTool>）',
  '  --force            允许覆盖已存在的文件',
].join('\n');

/** 一个待写入/预览的生成物 */
export interface ToolScaffoldFile {
  /** 绝对路径（预览时按相对项目根打印） */
  path: string;
  content: string;
}

export interface ToolScaffoldOptions {
  /** 工具名（snake_case，须与 `TOOL_NAME_CONSTANTS` 的键一致） */
  name: string;
  /** 工具描述（模型可见） */
  description: string;
  /** 工具目录（缺省 `app/src/tools/<XxxTool>`） */
  dir?: string;
}

/** `hello_world` → `HelloWorld`（工具类名 = 该值 + `Tool`） */
export function toPascalCase(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** 校验工具名口径：`[a-z][a-z0-9_]*`（与 `TOOL_NAME_CONSTANTS` 的标识符键一致） */
export function isValidToolName(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name);
}

/**
 * 纯函数：构造生成物（不触碰磁盘，便于单测）。
 *
 * @returns 两个文件：`<XxxTool>/<XxxTool>.ts` 与 `<XxxTool>/schemas.ts`
 */
export function buildToolScaffold(options: ToolScaffoldOptions): ToolScaffoldFile[] {
  const { name, description } = options;
  const base = toPascalCase(name);
  const className = `${base}Tool`;
  const schemaName = `${base}InputSchema`;
  const dir = options.dir ?? join(TOOL_SCAFFOLD_APP_DIR, 'src', 'tools', className);

  const toolContent = `/**
 * ${className} — \`${name}\`（骨架；由 \`bun run gen:tool-scaffold\` 生成）
 *
 * 生成后即**普通代码**：请按真实需求改写 description / params / execute，
 * 并补齐 \`schemas.ts\` 的入参字段。
 */
import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
import { BaseTool } from '../BaseTool';
import type { ToolParam, ToolResult, ToolUseContext } from '../types/index';
import { ${schemaName} } from './schemas';

export class ${className} extends BaseTool {
  name = TOOL_NAME_CONSTANTS.${name};

  description = ${JSON.stringify(description)};

  params: ToolParam[] = [];

  /** U-03：模型可见出参结构（须与 execute 返回的 data 键集一致） */
  override readonly outputJsonSchema = {
    type: 'object',
    properties: {
      ok: { type: 'boolean', description: '是否成功' },
    },
  };

  async execute(input: unknown, _context: ToolUseContext): Promise<ToolResult> {
    const parsed = ${schemaName}.safeParse(input ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (issue) => \`\${issue.path.join('.')}: \${issue.message}\`
      );
      return { success: false, error: \`${name} 输入无效: \${issues.join('; ')}\` };
    }
    // 未实现前**明确失败**，不返回占位数据（CS04）。实现后请删除本行注释。
    return { success: false, error: '${name} 尚未实现（骨架）' };
  }
}

export function create${className}(): ${className} {
  return new ${className}();
}
`;

  const schemaContent = `import { z } from 'zod';

/**
 * ${name} 输入模式（骨架：按真实参数补字段；「strictObject」会拒绝未声明字段）
 */
export const ${schemaName} = z.strictObject({});

export type ${base}Input = z.infer<typeof ${schemaName}>;
`;

  return [
    { path: join(dir, `${className}.ts`), content: toolContent },
    { path: join(dir, 'schemas.ts'), content: schemaContent },
  ];
}

/**
 * 纯函数：生成**注册面登记清单**（不自动改写，理由见文件头）。
 *
 * @param category `toolCategories` 的类别（缺省 `misc`，但 `misc` 会被任务白名单裁掉）
 * @param effect `TOOL_EFFECTS` 的效果（`none` 只读 / `local` 本地写 / `external` 外部副作用）
 */
export function buildRegistrationChecklist(
  name: string,
  category = 'misc',
  effect: 'none' | 'local' | 'external' = 'none'
): string[] {
  const base = toPascalCase(name);
  const className = `${base}Tool`;
  return [
    `1) packages/infra/src/constants/toolNameConstants.ts —— 在 TOOL_NAME_CONSTANTS 中按字母序加： ${name}: '${name}',`,
    `2) app/src/tools/factories/builtinToolRegistry.ts —— 在 BUILTIN_TOOL_FACTORIES 中加： create${className}: () => new ${className}(),（并 import 该类）`,
    `3) app/src/tools/utils/ToolManagerUtils.ts —— 在 loader 清单中加： byKey('create${className}'),`,
    `4) cd app && bun run gen:toolnames —— 重生成 toolNames.generated.ts（**必须先于第 5 步**：TOOL_EFFECTS 的键类型来自该生成物，顺序颠倒 typecheck 必红）`,
    `5) app/src/tools/toolEffects.ts —— 在 TOOL_EFFECTS 中加： ${name}: '${effect}',（lint:tool-schema 的"已声明能力"判据）`,
    `6) app/src/tools/toolCategories.ts —— 在 TOOL_CATEGORY_ENTRIES 中加： ${name}: '${category}',（不登记 ⇒ 落 misc，会被任务白名单裁掉）`,
    `7) cd app && bun run params:export && bun run descriptions:export —— 刷新模型可见的工具参数 / 描述快照`,
    `8) 测试：新增 app/tests/tools/${className}.test.ts（bun:test + 直接 new 工具 + \`execute(input, {} as never)\`）`,
    '9) 门禁：cd app && bun run typecheck && bun run lint:tool-schema && bun run lint:tool-risk && bun run lint:shadow-tools && bun run lint:toolname-branches && bun run params:check && bun run descriptions:check',
  ];
}

interface ParsedArgs {
  name?: string;
  description?: string;
  dir?: string;
  write: boolean;
  force: boolean;
  error?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { write: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') {
      parsed.write = true;
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--desc') {
      parsed.description = argv[i + 1];
      i += 1;
    } else if (arg === '--dir') {
      parsed.dir = argv[i + 1];
      i += 1;
    } else if (!arg.startsWith('--') && !parsed.name) {
      parsed.name = arg;
    }
  }
  if (!parsed.name) parsed.error = '缺少工具名';
  else if (!isValidToolName(parsed.name))
    parsed.error = `工具名须匹配 [a-z][a-z0-9_]*（当前：${parsed.name}）`;
  else if (!parsed.description?.trim())
    parsed.error = '缺少 --desc（工具描述是模型可见契约，不能留空）';
  return parsed;
}

/** 工具名是否已在常量表声明（同名字面量出现即视为已声明） */
function isDeclaredInConstantsTable(name: string): boolean {
  const file = join(
    TOOL_SCAFFOLD_APP_DIR,
    '..',
    'packages',
    'infra',
    'src',
    'constants',
    'toolNameConstants.ts'
  );
  if (!existsSync(file)) return false;
  return new RegExp(`\\b${name}\\s*:`).test(readFileSync(file, 'utf-8'));
}

function relativeToApp(file: string): string {
  return file.slice(TOOL_SCAFFOLD_APP_DIR.length + 1).replace(/\\/g, '/');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.error || !args.name || !args.description) {
    console.error(`[gen-tool-scaffold] ❌ ${args.error ?? '参数不完整'}\n${TOOL_SCAFFOLD_USAGE}`);
    process.exit(1);
    return;
  }

  if (isDeclaredInConstantsTable(args.name)) {
    console.error(
      `[gen-tool-scaffold] ❌ 工具名 \`${args.name}\` 已在 TOOL_NAME_CONSTANTS 中声明 —— 改名或确认是否要复用既有实现（避免同名两套实现）。`
    );
    process.exit(1);
    return;
  }

  const files = buildToolScaffold({
    name: args.name,
    description: args.description,
    ...(args.dir ? { dir: resolve(args.dir) } : {}),
  });

  const conflicts = files.filter((f) => existsSync(f.path));
  if (conflicts.length > 0 && !args.force) {
    console.error(
      `[gen-tool-scaffold] ❌ 目标文件已存在（如需覆盖加 --force）：\n  ${conflicts
        .map((f) => relativeToApp(f.path))
        .join('\n  ')}`
    );
    process.exit(1);
    return;
  }

  console.log('[gen-tool-scaffold] 生成物：');
  for (const file of files) {
    console.log(`  - ${relativeToApp(file.path)}（${file.content.length} 字节）`);
  }

  if (args.write) {
    for (const file of files) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.content, 'utf-8');
    }
    console.log('[gen-tool-scaffold] ✅ 已落盘（下一步按登记清单手动接线）');
  } else {
    console.log('[gen-tool-scaffold] 预览模式：未写盘（加 --write 落盘）');
  }

  console.log('\n[gen-tool-scaffold] 注册面登记清单（**按序执行**）：');
  for (const line of buildRegistrationChecklist(args.name)) {
    console.log(`  ${line}`);
  }

  process.exit(0);
}

// 仅**直接运行**时执行（被测试 import 时不触发）
if (import.meta.main) {
  main();
}
