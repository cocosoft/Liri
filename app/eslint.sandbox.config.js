import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';

/**
 * `packages/sandbox/**` 的 ESLint 配置（P1 拆包配套，2026-11-12）。
 *
 * **为什么必须单独一份**：ESLint 9 的 flat config 以**配置文件所在目录**为 basePath，并**静默跳过**
 * basePath 之外的文件。`bun run lint`（cwd=app）只扫 `src tests`，而 `app/eslint.config.js` 也无法覆盖
 * `../packages/sandbox/src`（实测 exit 2：outside of base path）。沙箱拆包前在 `app/src` 内是被 lint 的，
 * 拆出后若不补，属**覆盖回归**。
 *
 * **为什么由仓库根调用**：带 `--config` 时 basePath 与匹配模式按 **cwd** 解析（同
 * `eslint.scripts.config.js` 的既有结论），故 `lint:sandbox` 是 `cd .. && node …`。
 *
 * **为什么用 `node` 而不是 `bun`**：实测从仓库根用 bun 运行 eslint，一旦**有结果**要输出，
 * stylish 格式化器即崩在 `chalk.underline is not a function`；用 node 运行正常（或加 `--format json`）。
 *
 * **为什么刻意不设 `parserOptions.project`**：类型化 project 的路径按 **cwd** 解析，仓库根没有
 * `tsconfig.eslint.json`（实测 51 个 `TS5012`）。而本配置启用的规则（prettier / no-console /
 * no-explicit-any / no-unused-vars / complexity）**均不需要类型信息**，故无功能损失。
 *
 * **为什么 prettier 选项内联**：仓库根没有 `.prettierrc`，从根运行时 prettier 会落到默认值（双引号）。
 * 这里显式对齐 `app/.prettierrc.json`，避免再引入一份 prettier 配置。
 *
 * **规则口径**：对齐 `app/eslint.config.js` 对沙箱的既有覆盖（含 `complexity` 棘轮、`no-console: error`——
 * 沙箱内实测零裸 console），仅去掉需要 app 侧插件/类型信息的规则。
 */
export default [
  {
    files: ['packages/sandbox/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': [
        'error',
        {
          semi: true,
          trailingComma: 'es5',
          singleQuote: true,
          printWidth: 80,
          tabWidth: 2,
          useTabs: false,
          endOfLine: 'lf',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // 与 app 主配置同口径（R10 最小启用：只启圈复杂度，warn 不阻断）
      complexity: ['warn', 40],
      'no-console': 'error',
      'no-debugger': 'error',
    },
  },
];
