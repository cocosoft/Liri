import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';

/**
 * 仓库根 `scripts/**` 的 ESLint 配置（待办 ⑨，2026-09-25）。
 *
 * **为什么需要单独一份**：ESLint 9 的 flat config 以**配置文件所在目录**为 basePath，并**静默跳过**
 * basePath 之外的文件 —— 实测 `eslint ../scripts/lint-unref.ts`（cwd=app）只得到
 * `warning  File ignored because outside of base path` 且 **exit 0**，即根脚本从未被 lint 过。
 * 官方对该场景的指引是"把配置放到父目录 / 从项目根运行"；带 `--config` 时模式与 basePath 均按
 * **cwd** 解析 ⇒ 本配置由 `bun run lint:scripts`（见 `app/package.json`）从**仓库根**调用。
 * 实测反证：在 `app/eslint.config.js` 内挂 `basePath: '..'` **无效**（仍报 outside of base path）。
 *
 * **为什么放在 `app/` 内**：配置自身的 `import '@typescript-eslint/*'` 必须能解析 —— 仓内只有
 * `app/node_modules` 与 `client/node_modules`，仓库根没有 node_modules。
 *
 * **为什么刻意不设 `parserOptions.project`**：`app/eslint.config.js` 用 `tsconfig.eslint.json` 做
 * 类型化 lint，但根脚本只 import node/bun 内置与 `typescript`，其模块解析不经过 app/node_modules
 * ⇒ 强行挂 project 会全线 `TS5012 / Cannot find module`。且本仓**已启用的规则无一需要类型信息**
 * （prettier / no-explicit-any / no-unused-vars / no-console 均非类型化规则），故无功能损失。
 *
 * **prettier 选项为何内联**：prettier 按"配置文件就近向上查找"解析选项，而仓库根没有
 * `.prettierrc`，根脚本会落到 prettier 默认值（双引号）⇒ 与全仓 `singleQuote` 约定冲突。
 * 这里显式对齐 `app/.prettierrc.json`，避免为根目录再引入一份 prettier 配置。
 */
export default [
  {
    files: ['scripts/**/*.ts'],
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
      // 脚本是 CLI 工具：向终端输出即其职责（与 app 内 `src/scripts/**` 的豁免口径一致）
      'no-console': 'off',
      'no-debugger': 'error',
    },
  },
];
