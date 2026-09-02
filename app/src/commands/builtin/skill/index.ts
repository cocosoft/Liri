// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 技能命令
 * 管理和查看技能
 */
import { join } from 'path';
import type { Command, CommandContext } from '@modules/commands';
import { SkillRegistry } from '@modules/skills/SkillRegistry.js';
import { SkillSource } from '@modules/skills/types';
import { FileSkillLoader } from '@modules/skills/loaders/sources/FileSkillLoader.js';
import { PluginSkillLoader } from '@modules/skills/loaders/sources/PluginSkillLoader.js';
import { MCPSkillLoader } from '@modules/skills/loaders/sources/MCPSkillLoader.js';
import { BundledSkillLoader } from '@modules/skills/loaders/sources/BundledSkillLoader.js';
import { collectSkillsFromProviders } from '@modules/skills/loaders/SkillProvider.js';
import { resolveUserSkillsDir, resolveDataDir } from '@modules/core';

/** 加载所有技能到注册表（统一经 SkillProvider 契约聚合，顺序语义与原 loaders 数组一致） */
async function loadAllSkills(): Promise<SkillRegistry> {
  const registry = new SkillRegistry();
  const providers = [
    new BundledSkillLoader(),
    new FileSkillLoader({
      directories: [resolveUserSkillsDir()],
      source: SkillSource.THIRD_PARTY,
      loadedFrom: 'user',
    }),
    new FileSkillLoader({
      directories: [join(resolveDataDir(), 'skills')],
      source: SkillSource.OFFICIAL,
      loadedFrom: 'project',
    }),
    new PluginSkillLoader(),
    new MCPSkillLoader(),
  ];
  const skills = await collectSkillsFromProviders(providers, {
    // L1：显式启用 rank 语义（低 rank 优先），与数组顺序解耦；当前顺序等价，行为不变
    sortByRank: true,
  });
  registry.registerBatch(skills);
  return registry;
}

/**
 * 技能命令
 */
export const skillCommand: Command = {
  type: 'action',
  name: 'skill',
  description: '管理和查看技能',
  aliases: ['sk', 'skills'],
  argumentHint: '[list|info|enable|disable|reload]',
  whenToUse: '当你需要管理或查看系统技能时',
  load: async () => ({
    execute: async (args: string, context: CommandContext) => {
      let registry = await loadAllSkills();

      const parts = args.split(/\s+/);
      const subcommand = parts[0];
      const restArgs = parts.slice(1).join(' ');

      switch (subcommand) {
        case '': {
          // 没有子命令，显示技能概览
          const skills = registry
            .getAll()
            .filter((s) => s.userInvocable !== false);
          const loadedCount = skills.length;

          let content = `🧰 技能概览\n\n`;
          content += `总技能数: ${loadedCount}\n\n`;

          if (skills.length > 0) {
            content += `可用技能:\n`;
            skills.forEach((skill) => {
              content += `  ✅ ${skill.name.padEnd(15)} - ${skill.description || 'No description'}\n`;
            });
          } else {
            content += `暂无可用技能\n`;
          }

          content += `\n命令用法:\n`;
          content += `  /skill list          - 列出所有技能（详细）\n`;
          content += `  /skill info <技能名>  - 查看技能详情\n`;
          content += `  /skill enable <技能名> - 启用技能\n`;
          content += `  /skill disable <技能名> - 禁用技能\n`;
          content += `  /skill reload        - 重新加载技能\n`;

          return {
            success: true,
            type: 'text',
            value: content,
            message: content,
          };
        }

        case 'list': {
          const skills = registry.getAll();
          if (skills.length === 0) {
            return {
              success: true,
              type: 'text',
              value: '没有找到可用的技能',
              message: '没有找到可用的技能',
            };
          }

          let content = `📋 所有技能 (${skills.length})\n\n`;
          skills.forEach((skill) => {
            content += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            content += `名称:     ${skill.name}\n`;
            content += `描述:     ${skill.description || 'No description'}\n`;
            content += `来源:     ${skill.source}\n`;
            content += `用户可调用: ${skill.userInvocable ? '是' : '否'}\n`;
            if (skill.argumentHint) {
              content += `参数:     ${skill.argumentHint}\n`;
            }
            if (skill.whenToUse) {
              content += `使用场景: ${skill.whenToUse}\n`;
            }
          });

          return {
            success: true,
            type: 'text',
            value: content,
            message: content,
          };
        }

        case 'info': {
          if (!restArgs) {
            return {
              success: false,
              type: 'error',
              message: '请提供技能名称: /skill info <技能名>',
            };
          }
          const skill = registry.get(restArgs);
          if (!skill) {
            return {
              success: false,
              type: 'error',
              message: `未找到技能: ${restArgs}`,
            };
          }

          let content = `📄 ${skill.name}\n\n`;
          content += `描述:     ${skill.description || 'No description'}\n`;
          content += `来源:     ${skill.source}\n`;
          content += `用户可调用: ${skill.userInvocable ? '是' : '否'}\n`;
          if (skill.argumentHint) {
            content += `参数:     ${skill.argumentHint}\n`;
          }
          if (skill.whenToUse) {
            content += `使用场景: ${skill.whenToUse}\n`;
          }
          if (skill.aliases && skill.aliases.length > 0) {
            content += `别名:     ${skill.aliases.join(', ')}\n`;
          }
          if (skill.allowedTools && skill.allowedTools.length > 0) {
            content += `允许的工具: ${skill.allowedTools.join(', ')}\n`;
          }

          return {
            success: true,
            type: 'text',
            value: content,
            message: content,
          };
        }

        case 'enable': {
          const enableSkill = restArgs;
          // includeDisabled：被禁技能在运行时视图不可见，需管理视图查找后重新启用
          const skillToEnable = registry.get(enableSkill, {
            includeDisabled: true,
          });
          if (skillToEnable) {
            registry.setEnabled(enableSkill, true);
            return {
              success: true,
              type: 'text',
              value: `✅ 已启用技能: ${enableSkill}`,
              message: `✅ 已启用技能: ${enableSkill}`,
            };
          } else {
            return {
              success: false,
              type: 'error',
              message: `未找到技能: ${enableSkill}`,
            };
          }
        }

        case 'disable': {
          const disableSkill = restArgs;
          const skillToDisable = registry.get(disableSkill, {
            includeDisabled: true,
          });
          if (skillToDisable) {
            registry.setEnabled(disableSkill, false);
            return {
              success: true,
              type: 'text',
              value: `❌ 已禁用技能: ${disableSkill}`,
              message: `❌ 已禁用技能: ${disableSkill}`,
            };
          } else {
            return {
              success: false,
              type: 'error',
              message: `未找到技能: ${disableSkill}`,
            };
          }
        }

        case 'reload': {
          registry = await loadAllSkills();
          const skills = registry.getAll();
          return {
            success: true,
            type: 'text',
            value: `🔄 已重新加载技能\n\n总技能数: ${skills.length}`,
            message: `🔄 已重新加载技能\n\n总技能数: ${skills.length}`,
          };
        }

        default: {
          // 尝试作为技能名称处理
          const skill = registry.get(subcommand);
          if (skill) {
            // 显示技能详情
            let content = `📄 ${skill.name}\n\n`;
            content += `描述:     ${skill.description || 'No description'}\n`;
            content += `来源:     ${skill.source}\n`;
            content += `用户可调用: ${skill.userInvocable ? '是' : '否'}\n`;
            if (skill.argumentHint) {
              content += `参数:     ${skill.argumentHint}\n`;
            }
            if (skill.whenToUse) {
              content += `使用场景: ${skill.whenToUse}\n`;
            }

            return {
              success: true,
              type: 'text',
              value: content,
              message: content,
            };
          }

          return {
            success: false,
            type: 'error',
            message: `无效的子命令。用法: /skill [list|info|enable|disable|reload]`,
          };
        }
      }
    },
  }),
};
