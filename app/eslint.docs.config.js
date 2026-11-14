import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';

/**
 * `packages/docs` 的 ESLint 配置（P1 拆包配套，2026-11-13）。
 *
 * **为什么必须单独一份**：ESLint 9 的 flat config 以**配置文件所在目录**为 basePath，并**静默跳过**
 * basePath 之外的文件。`bun run lint`（cwd=app）只扫 `src tests`，而 `app/eslint.config.js` 也无法覆盖
 * `packages/docs/src`（同前八份包配置）。
 *
 * **规则口径**：`src/docs` 拆包前在 app 主配置里有两处专项 ——
 * ① `src/docs` 全目录在 `no-console: off` 名单内（文档工具直接向终端打印）；
 * ② `src/docs` 全目录对 `no-explicit-any` / `no-unused-vars` 关闭（存量口径）。
 * 本配置逐条对齐，拆包后不得新增告警。
 */
export default [
  {
    files: ['packages/docs/**/*.ts'],
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
  {
    // 与 app 主配置对齐：`src/docs` 是文档工具的终端输出承担者
    files: ['packages/docs/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
