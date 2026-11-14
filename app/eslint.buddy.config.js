import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';

/**
 * `packages/buddy` 的 ESLint 配置（P1 拆包配套，2026-11-14）。
 *
 * **为什么必须单独一份**：ESLint 9 的 flat config 以**配置文件所在目录**为 basePath，并**静默跳过**
 * basePath 之外的文件。`bun run lint`（cwd=app）只扫 `src tests`，而 `app/eslint.config.js` 也无法覆盖
 * `packages/buddy/src`（同前二十份包配置）。
 *
 * **规则口径（对齐原 `src/buddy`）**：该目录原本在 `app/eslint.config.js` 的
 * `no-console: 'off'` override 名单内（L344 `'src/buddy/**'`）⇒ 本配置**保留该豁免**；
 * 其余沿用默认口径（`no-explicit-any` / `no-unused-vars` 保持 `warn`）。
 */
export default [
  {
    files: ['packages/buddy/**/*.ts'],
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
      // 原 `src/buddy/**` 在 app 主配置的 `no-console: 'off'` override 名单内 ⇒ 保留豁免
      'no-console': 'off',
      'no-debugger': 'error',
    },
  },
];
