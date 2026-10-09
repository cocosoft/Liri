import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';
import moduleRegistryPlugin from './tools/eslint-plugin-module-registry/index.js';

export default [
  {
    ignores: [
      '**/hooks/**/*.js',
      '**/config.d.ts',
      'src/utils/sinks.d.ts',
      'src/analytics/AnalyticsService.d.ts'
    ]
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 12,
        sourceType: 'module',
        project: './tsconfig.eslint.json'
      }
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
      prettier: prettierPlugin,
      'module-registry': moduleRegistryPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'error',
      'no-debugger': 'error',
      // R10（2026-10-09）状态复杂度门禁 — **最小启用**（「勿全量开启」）：
      // 只启「圈复杂度」一项，且为 **warn（不阻断）**。阈值 40 取自实测分布
      // （`bun run scripts/state-complexity-audit.ts`：P99=26，≥40 仅 76 个函数）
      // ⇒ 高于 P99、只对**真离群**发信号，防止新代码继续堆复杂度。
      // 数据与可行性评估见 `dev_docs/20261009/复查任务计划.md §1.9`。
      complexity: ['warn', 40],
      'module-registry/no-direct-module-import': ['error', {
        // B2-3（2026-09-23）：`tasks/goal/goalTemplates` 是**跨模块共享的纯常量模块**
        // （零依赖、无实例/无生命周期、不需 ModuleRegistry 管理）⇒ 显式豁免直连。
        // 动机：`query/TAORLoop` 与 `chat/ReActToolLoop` 的续接文案必须**同源**
        //（CS01：禁止逐字重复副本），而"续接指令"是文案常量、无法经
        // `moduleRegistry.resolve<T>()` 在模块初始化期同步取得。
        // 见 `.trae/specs/goal-entity.md` §5.3.1 #1/#2。
        allowedPaths: ['\\/goalTemplates$'],
      }],
      'no-restricted-imports': ['warn', {
        paths: [
          {
            name: '@modules/utils/log',
            message: '请使用 @modules/monitoring/logs/Logger',
          },
          {
            name: '@modules/utils/log.js',
            message: '请使用 @modules/monitoring/logs/Logger',
          },
          {
            name: '@modules/utils/monitoring',
            message: '日志功能已迁移至 @modules/monitoring 系列模块，metrics 功能使用 monitoring/metrics',
          },
          {
            name: '@modules/utils/monitoring.js',
            message: '日志功能已迁移至 @modules/monitoring 系列模块，metrics 功能使用 monitoring/metrics',
          },
          {
            name: '@modules/core/paths',
            importNames: ['resolveSoulDir'],
            message: '[路径规范] resolveSoulDir() 指向 data/soul/（第二层），SOUL.md 应使用 resolveSoulPath()，USER.md 应使用 resolveUserProfilePath()',
          },
        ],
        patterns: [
          {
            group: ['@modules/security/*'],
            message: '禁止直接引用安全模块子路径，请通过 @modules/security 门面 API 访问',
          },
        ],
      }],
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'TemplateLiteral[quasis.0.value.raw="~/.pyapp"]',
          message: '[路径规范] 禁止硬编码 ~/.pyapp 路径，请使用 resolvePyappHome() 或 LIRI_HOME 环境变量',
        },
        {
          selector: 'Literal[value="~/.pyapp"]',
          message: '[路径规范] 禁止硬编码 ~/.pyapp 路径，请使用 resolvePyappHome() 或 LIRI_HOME 环境变量',
        },
      ],
      'custom-rules/no-top-level-side-effects': 'off',
      'custom-rules/no-top-level-dynamic-import': 'off',
      'custom-rules/no-process-env-top-level': 'off',
      'custom-rules/no-sync-fs': 'off',
      'custom-rules/no-process-cwd': 'off',
      'react-hooks/exhaustive-deps': 'off'
    }
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx', '**/*.spec.tsx'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      // R10：测试常以长分支/表驱动铺陈用例，复杂度门禁只针对**生产代码** ⇒ 测试关闭。
      complexity: 'off',
      'module-registry/no-direct-module-import': 'off'
    }
  },
  {
    files: ['src/modules/**', 'src/tools/**', 'src/runtime/**'],
    rules: {
      'module-registry/no-direct-module-import': 'off'
    }
  },
  {
    // 终端 UI 和 CLI 输出文件：精确豁免（仅保留真正需要终端输出的文件）
    files: [
      // UI 组件
      'src/ui/**/*.ts',
      'src/ui/**/*.tsx',
      // CLI 入口
      'src/cli/**/*.ts',
      'src/entrypoints/repl.ts',
      'src/entrypoints/api-handler.ts',
      // CLI 子命令
      'src/chronos/cli/**/*.ts',
      'src/hooks/cli/**/*.ts',
      'src/skills/cli/**/*.ts',
      'src/plugins/cli/**/*.ts',
      'src/bridge/cli/**/*.ts',
      'src/memory/cli/**/*.ts',
      'src/mcp/cli/**/*.ts',
      // 应用命令
      'src/commands/**/*.ts',
      // 文档工具
      'src/docs/**/*.ts',
      // 脚本工具
      'src/scripts/**/*.ts',
      // D-137（2026-09-30）：**顶层 `scripts/**`**（构建 / 运维 / 迁移脚本，~60 文件）此前不在
      // eslint 的 tsconfig project 内 ⇒ 根本无法 lint（补网后实测 631 处 `no-console`）。
      // 这些是 CLI 脚本，本就应允许终端打印 ⇒ 与 `src/scripts/**` 同口径豁免。
      'scripts/**/*.ts',
    ],
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: [
      'src/monitoring/logs/Logger.ts',
      'src/monitoring/exporters/ConsoleExporter.ts',
      'src/services/api/logging.ts',
      'src/utils/log.ts',
      'src/utils/debug.ts',
      'src/utils/monitoring.ts',
      'src/utils/startupProfiler.ts',
      'src/error/safeLog.ts',
    ],
    rules: {
      'no-console': 'off'
    }
  },
  {
    // 模块测试文件：允许 console 输出
    files: [
      'src/chat/ChatModuleTest.ts',
      'src/config/ConfigModuleTest.ts',
    ],
    rules: {
      'no-console': 'off'
    }
  },
  {
    // 独立终端 UI 文件：与 CLI 目录分离的终端输出文件
    files: [
      'src/main.ts',
      // 大文件拆分（spec file-size-debt-partition-plan）：`main.ts` 的启动前检查/首次引导
      // 簇外迁至此 ⇒ 与宿主同口径（首启引导本就向终端打印用户可见提示）
      'src/bootstrap/preflight.ts',
      'src/healthcheck.ts',
      'src/monitor.ts',
      'src/performance/**/*.ts',
      'src/security/audit/**/*.ts',
      'src/channels/setupChannels.ts',
      'src/channels/wechat/cli-manager.ts',
      'src/channels/DeliveryRouter.ts',
      'src/infrastructure/http/**/*.ts',
      'src/oauth/flows/**/*.ts',
      'src/tools/DependencyGraphScanner.ts',
      'src/monitoring/performance/PerformanceAnalyzer.ts',
      'src/monitoring/MonitoringService.ts',
      'src/ui/buddy/useBuddyNotification.tsx',
      'src/query/queryProfiler.ts',
      'src/query/SlowQueryDetector.ts',
      'src/core/paths.ts',
      'src/utils/errorHintManager.ts',
      'src/analytics/AnalyticsService.ts',
      'src/analytics/IntelligentAnalysisService.ts',
      'src/analytics/PerformanceMonitoringService.ts',
    ],
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: {
      ecmaVersion: 12,
      sourceType: 'module'
    },
    plugins: {
      prettier: prettierPlugin
    },
    rules: {
      'prettier/prettier': 'error',
      'no-console': 'error',
      'no-debugger': 'error'
    }
  },
  {
    files: [
      'src/governance/managers/**/*.js',
      'src/utils/*.js',
      'src/analytics/**/*.js',
      'src/context/**/*.js',
    ],
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: [
      'src/tools/**',
      'src/commands/**',
      'src/services/**',
      'src/hooks/**',
      'src/utils/**',
      'src/ai/**',
      'src/ink/**',
      'src/skills/**',
      'src/subagent/**',
      'src/security/**',
      'src/config/**',
      'src/agent/**',
      'src/bridge/**',
      'src/plugins/**',
      'src/session/**',
      'src/chronos/**',
      'src/cli/**',
      'src/monitoring/**',
      'src/core/**',
      'src/ui/**',
      'src/context/**',
      'src/governance/**',
      'src/performance/**',
      'src/error/**',
      'src/memory/**',
      'src/chat/**',
      'src/mcp/**',
      'src/permission/**',
      'src/tasks/**',
      'src/sandbox/**',
      'src/types/**',
      'src/analytics/**',
      'src/components/**',
      'src/remote/**',
      'src/entrypoints/**',
      'src/modules/**',
      'src/keybindings/**',
      'src/query/**',
      'src/cost/**',
      'src/docs/**',
      'src/testing/**',
      'src/daemon/**',
      'src/oauth/**',
      'src/streaming/**',
      'src/cache/**',
      'src/lsp/**',
      'src/scripts/**',
      'src/diagnostics/**',
      'src/media/**',
      'src/buddy/**',
      'src/subagents/**',
      'src/channels/**',
      'src/constants/**',
      'src/enterprise/**',
      'src/plugin-sdk/**',
      'src/promptSuggestion/**',
      'src/trace-recording/**',
      'src/vim/**',
      'src/healthcheck.ts',
      'src/main.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
];
