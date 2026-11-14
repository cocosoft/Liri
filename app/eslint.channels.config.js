import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';

/**
 * `packages/channels/**` 的 ESLint 配置（P1 拆包配套，2026-11-13）。
 *
 * **为什么必须单独一份**：ESLint 9 的 flat config 以**配置文件所在目录**为 basePath，并**静默跳过**
 * basePath 之外的文件。`bun run lint`（cwd=app）只扫 `src tests`，而 `app/eslint.config.js` 也无法覆盖
 * `../packages/channels/src`（实测 exit 2：outside of base path）。channels 拆包前在 `app/src` 内是被
 * lint 的，拆出后若不补，属**覆盖回归**（同 `eslint.sandbox.config.js` 的结论）。
 *
 * **为什么由仓库根调用 / 用 node 而不是 bun**：同 `eslint.sandbox.config.js` —— 带 `--config` 时
 * basePath 与匹配模式按 cwd 解析；用 bun 从仓库根运行会在输出结果时崩在
 * `chalk.underline is not a function`。
 *
 * **为什么刻意不设 `parserOptions.project`**：类型化 project 的路径按 cwd 解析，仓库根没有
 * `tsconfig.eslint.json`；本配置启用的规则均**不需要类型信息**。
 *
 * **规则口径**：与 `eslint.sandbox.config.js` 对齐（prettier / no-console / no-explicit-any /
 * no-unused-vars / complexity 棘轮）；channels 存量告警作为**观察起点**，不阻断。
 */
export default [
  {
    files: ['packages/channels/**/*.ts'],
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
    // 与 app 主配置对齐：这三个文件是**终端输出**承担者（拆包前即在 `no-console: off` 名单内）
    files: [
      'packages/channels/src/channels/setupChannels.ts',
      'packages/channels/src/channels/wechat/cli-manager.ts',
      'packages/channels/src/channels/DeliveryRouter.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // 与 app 主配置对齐：`src/channels/**` 拆包前即对 any / 未用变量关闭（存量口径不变）
    files: ['packages/channels/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
