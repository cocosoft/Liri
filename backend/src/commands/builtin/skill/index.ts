/**
 * 技能命令
 * 管理和查看技能
 */
import type { Command, CommandContext } from '../../types/index.js';
import { skillManager } from '../../../skills/managers/SkillManager.js';
import { UserSkillLoader } from '../../../skills/loaders/sources/UserSkillLoader.js';
import { ProjectSkillLoader } from '../../../skills/loaders/sources/ProjectSkillLoader.js';
import { PluginSkillLoader } from '../../../skills/loaders/sources/PluginSkillLoader.js';
import { MCPSkillLoader } from '../../../skills/loaders/sources/MCPSkillLoader.js';
import { BundledSkillLoader } from '../../../skills/loaders/sources/BundledSkillLoader.js';

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
      // 注册加载器
      skillManager.registerLoader(new BundledSkillLoader());
      skillManager.registerLoader(new UserSkillLoader());
      skillManager.registerLoader(new ProjectSkillLoader());
      skillManager.registerLoader(new PluginSkillLoader());
      skillManager.registerLoader(new MCPSkillLoader());

      // 加载技能
      await skillManager.loadSkills();

      const parts = args.split(/\s+/);
      const subcommand = parts[0];
      const restArgs = parts.slice(1).join(' ');

      switch (subcommand) {
        case '': {
          // 没有子命令，显示技能概览
          const skills = skillManager.getSkills({ userInvocable: true });
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
          const skills = skillManager.getSkills();
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
          const skill = skillManager.getSkill(restArgs);
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
          const skillToEnable = skillManager.getSkill(enableSkill);
          if (skillToEnable) {
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
          const skillToDisable = skillManager.getSkill(disableSkill);
          if (skillToDisable) {
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
          await skillManager.loadSkills(true);
          const skills = skillManager.getSkills();
          return {
            success: true,
            type: 'text',
            value: `🔄 已重新加载技能\n\n总技能数: ${skills.length}`,
            message: `🔄 已重新加载技能\n\n总技能数: ${skills.length}`,
          };
        }

        default: {
          // 尝试作为技能名称处理
          const skill = skillManager.getSkill(subcommand);
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