import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';

/**
 * `packages/compaction` 的 ESLint 配置（P1 拆包配套，2026-11-13）。
 *
 * **为什么必须单独一份**：ESLint 9 的 flat config 以**配置文件所在目录**为 basePath，并**静默跳过**
 * basePath 之外的文件。`bun run lint`（cwd=app）只扫 `src tests`，而 `app/eslint.config.js` 也无法覆盖
 * `packages/compaction/src`（同 sandbox / channels / query / skills / tokenBudget / vfs 六份包配置）。
 *
 * **为什么由仓库根调用 / 用 node 而不是 bun**：带 `--config` 时 basePath 与匹配模式按 cwd 解析；
 * 用 bun 从仓库根运行会在输出结果时崩在 `chalk.underline is not a function`。
 *
 * **规则口径**：`src/compaction` 拆包前走 app 主配置的**默认口径**（无 any / unused 专项豁免）
 * ⇒ 保持 `warn`，不借迁包放宽。
 */
export default [
  {
    files: ['packages/compaction/**/*.ts'],
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
