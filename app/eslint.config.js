import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';
import moduleRegistryPlugin from './tools/eslint-plugin-module-registry/index.js';

export default [
  {
    ignores: [
      '**/hooks/**/*.js',
      '**/config.d.ts'
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
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'warn',
      'no-debugger': 'error',
      'module-registry/no-direct-module-import': 'warn',
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
      'module-registry/no-direct-module-import': 'off'
    }
  },
  {
    files: ['src/modules/**', 'src/tools/**'],
    rules: {
      'module-registry/no-direct-module-import': 'off'
    }
  },
  {
    files: [
      'src/cli/**/*.ts',
      'src/entrypoints/**',
      'src/ui/**/*.ts',
    ],
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: [
      'src/chronos/cli/**/*.ts',
      'src/hooks/cli/**/*.ts',
      'src/skills/cli/**/*.ts',
      'src/plugins/cli/**/*.ts',
      'src/bridge/cli/**/*.ts',
      'src/memory/cli/**/*.ts',
      'src/mcp/cli/**/*.ts',
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
      'src/utils/logger.ts',
      'src/utils/debug.ts',
      'src/utils/monitoring.ts',
      'src/utils/startupProfiler.ts',
      'src/utils/logging/LogSink.ts',
    ],
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: [
      'src/agent/AgentModuleTest.ts',
      'src/chat/ChatModuleTest.ts',
      'src/config/ConfigModuleTest.ts',
      'src/error/ErrorModuleTest.ts',
    ],
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: [
      'src/wizard/**/*.ts',
      'src/security/**/*.ts',
      'src/hooks/**/*.ts',
      'src/channels/**/*.ts',
      'src/chronos/**/*.ts',
      'src/error/**/*.ts',
      'src/tools/adapters/**/*.ts',
      'src/tools/ModuleMigrationTool.ts',
      'src/components/**/*.ts',
      'src/components/**/*.tsx',
      'src/commands/builtin/**/*.ts',
      'src/commands/prompt/**/*.ts',
      'src/commands/progress/**/*.ts',
      'src/agent/events/**/*.ts',
      'src/chat/services/**/*.ts',
      'src/query/**/*.ts',
      'src/promptSuggestion/**/*.ts',
      'src/ink/**/*.tsx',
      'src/buddy/**/*.tsx',
      'src/performance/**/*.ts',
      'src/monitoring/**/*.ts',
      'src/analytics/**',
      'src/ai/telemetry/**/*.ts',
      'src/context/**',
      'src/monitor.ts',
      'src/healthcheck.ts',
      'src/utils/errorHintManager.ts',
    ],
    rules: {
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
      'no-console': 'warn',
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
