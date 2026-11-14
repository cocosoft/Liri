import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';

/**
 * `packages/tokenBudget` 的 ESLint 配置（P1 拆包配套，2026-11-13）。
 *
 * **为什么必须单独一份**：ESLint 9 的 flat config 以**配置文件所在目录**为 basePath，并**静默跳过**
 * basePath 之外的文件。`bun run lint`（cwd=app）只扫 `src tests`，而 `app/eslint.config.js` 也无法覆盖
 * `packages/tokenBudget/src`（同 sandbox / channels / query / skills 四份包配置的成因）。
 *
 * **为什么由仓库根调用 / 用 node 而不是 bun**：带 `--config` 时 basePath 与匹配模式按 cwd 解析；
 * 用 bun 从仓库根运行会在输出结果时崩在 `chalk.underline is not a function`。
 *
 * **为什么刻意不设 `parserOptions.project`**：类型化 project 的路径按 cwd 解析，仓库根没有
 * `tsconfig.eslint.json`；本配置启用的规则均**不需要类型信息**。
 *
 * **规则口径**：`src/tokenBudget` 拆包前走 app 主配置的**默认口径**（没有 any / unused 的专项豁免），
 * 因此这里保持 `warn` 而**不是** `off` —— 拆包不得借机放宽既有告警。
 */
export default [
  {
    files: ['packages/tokenBudget/**/*.ts'],
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
      // 与 app 主配置同口径（最小启用：只启圈复杂度，warn 不阻断）
      complexity: ['warn', 40],
      'no-console': 'error',
      'no-debugger': 'error',
    },
  },
];
