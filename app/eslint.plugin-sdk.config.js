import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';

/**
 * `packages/plugin-sdk` 的 ESLint 配置（P1 拆包配套，2026-11-13）。
 *
 * **为什么必须单独一份**：ESLint 9 的 flat config 以**配置文件所在目录**为 basePath，并**静默跳过**
 * basePath 之外的文件。`bun run lint`（cwd=app）只扫 `src tests`，而 `app/eslint.config.js` 也无法覆盖
 * `packages/plugin-sdk/src`（同前十份包配置）。
 *
 * **规则口径**：`src/plugin-sdk` 拆包前在 app 主配置里只有一处专项 —— 该目录在
 * `no-explicit-any` / `no-unused-vars` 的关闭名单内（存量口径）。本配置逐条对齐，拆包后不得新增告警。
 */
export default [
  {
    files: ['packages/plugin-sdk/**/*.ts'],
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
    // 与 app 主配置对齐：`src/plugin-sdk/**` 走存量口径
    files: ['packages/plugin-sdk/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
