/**
 * Modules命令
 * 模块系统管理：查看模块列表、运行依赖验证
 */
import type { Command } from '@modules/commands/types';

const modulesCommand: Command = {
  type: 'action',
  name: 'modules',
  description: '模块系统管理 — 查看模块列表和运行依赖验证',
  aliases: ['mod', 'module'],
  argumentHint: '[list|validate]',
  whenToUse: '当你需要查看已注册的模块信息、检查模块依赖关系或验证模块配置时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase() || '';
      const restArgs = parts.slice(1).join(' ');

      switch (subcommand) {
        case 'list': {
          const { MODULE_DEFINITIONS, MODULE_INITIALIZATION_ORDER } = await import(
            '../../../modules/ModuleDefinitions.js'
          );

          const moduleEntries = Object.entries(MODULE_DEFINITIONS);
          const orderedSet = new Set(MODULE_INITIALIZATION_ORDER);

          const lines: string[] = [
            `模块定义总数: ${moduleEntries.length}`,
            `初始化顺序条目: ${MODULE_INITIALIZATION_ORDER.length}`,
            '',
            '=== 模块定义列表 ===',
          ];

          for (const [id, def] of moduleEntries.sort(([a], [b]) => {
            const ai = MODULE_INITIALIZATION_ORDER.indexOf(a);
            const bi = MODULE_INITIALIZATION_ORDER.indexOf(b);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
          })) {
            const inOrder = orderedSet.has(id) ? '✓' : '✗';
            const deps = def.dependencies.length > 0
              ? `依赖: [${def.dependencies.join(', ')}]`
              : '无依赖';
            const optDeps = def.optionalDependencies.length > 0
              ? `可选: [${def.optionalDependencies.join(', ')}]`
              : '';
            lines.push(
              `  ${inOrder} ${id} (${def.displayName}) v${def.version}`,
              `     类别: ${def.category} | ${deps}${optDeps ? ' ' + optDeps : ''}`
            );
          }

          return { success: true, message: lines.join('\n') };
        }

        case 'validate':
        case 'check': {
          const includeDetails = restArgs.includes('--verbose') || restArgs.includes('-v');

          const { DependencyValidator } = await import(
            '../../../tools/DependencyValidator.js'
          );
          const validator = new DependencyValidator();
          const result = validator.validateAllDependencies();

          const lines: string[] = [
            result.valid ? '✅ 模块依赖验证通过' : '❌ 模块依赖验证发现以下问题:',
            '',
          ];

          if (result.errors.length > 0) {
            lines.push(`【错误】(${result.errors.length} 项)`);
            for (const err of result.errors) {
              lines.push(`  ❌ ${err}`);
            }
            lines.push('');
          }

          if (result.missingDependencies.length > 0) {
            lines.push(`【缺失依赖】(${result.missingDependencies.length} 项)`);
            for (const dep of result.missingDependencies) {
              lines.push(`  ⚠ ${dep}`);
            }
            lines.push('');
          }

          if (result.circularDependencies.length > 0) {
            lines.push(`【循环依赖】(${result.circularDependencies.length} 项)`);
            for (const cycle of result.circularDependencies) {
              lines.push(`  🔄 ${cycle.join(' → ')}`);
            }
            lines.push('');
          }

          if (result.initializationOrderIssues.length > 0) {
            lines.push(`【初始化顺序问题】(${result.initializationOrderIssues.length} 项)`);
            for (const issue of result.initializationOrderIssues) {
              lines.push(`  ⚠ ${issue}`);
            }
            lines.push('');
          }

          if (result.optionalDepIssues.length > 0) {
            lines.push(`【可选依赖问题】(${result.optionalDepIssues.length} 项)`);
            for (const issue of result.optionalDepIssues) {
              lines.push(`  ⚠ ${issue}`);
            }
            lines.push('');
          }

          if (result.versionIssues.length > 0) {
            lines.push(`【版本号问题】(${result.versionIssues.length} 项)`);
            for (const issue of result.versionIssues) {
              lines.push(`  ⚠ ${issue}`);
            }
            lines.push('');
          }

          if (includeDetails && result.dependencyGraph) {
            lines.push('=== 依赖关系图 ===');
            const moduleIds = Object.keys(result.dependencyGraph).sort();
            for (const id of moduleIds) {
              const deps = result.dependencyGraph[id];
              if (deps.length > 0) {
                lines.push(`  ${id} → ${deps.join(', ')}`);
              }
            }
          }

          return { success: true, message: lines.join('\n') };
        }

        case '': {
          return {
            success: true,
            message: [
              '模块命令用法:',
              '',
              '/modules list           - 列出所有模块定义',
              '/modules validate       - 运行模块依赖验证',
              '/modules check          - 同 validate',
              '',
              '选项:',
              '  --verbose, -v         - 显示详细依赖关系图',
              '',
              '别名: /mod, /module',
            ].join('\n'),
          };
        }

        default:
          return {
            success: false,
            error: `未知子命令: ${subcommand}。可用命令: list, validate`,
          };
      }
    },
  }),
};

export { modulesCommand };
