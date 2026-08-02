/**
 * Skills CLI 命令
 * 基于 SkillRegistry 的统一命令行管理接口
 */

import { join } from 'path';
import { Command } from 'commander';
import { SkillRegistry } from '../SkillRegistry';
import { SkillSource } from '../types';
import { FileSkillLoader } from '../loaders/sources/FileSkillLoader';
import { BundledSkillLoader } from '../loaders/sources/BundledSkillLoader';
import { PluginSkillLoader } from '../loaders/sources/PluginSkillLoader';
import { MCPSkillLoader } from '../loaders/sources/MCPSkillLoader';
import { resolveUserSkillsDir, resolveDataDir } from '../../core/paths';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('skills');

// 颜色输出
const chalk = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};

/**
 * 创建注册表并加载所有技能
 */
async function loadAllSkills(): Promise<SkillRegistry> {
  const registry = new SkillRegistry();

  // 收集所有加载器
  const loaders = [
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

  // 并行加载
  const results = await Promise.all(
    loaders.map((loader) => loader.loadSkills())
  );

  // 批量注册
  for (const skills of results) {
    registry.registerBatch(skills);
  }

  return registry;
}

/**
 * 注册Skills CLI命令
 * @param program Commander程序实例
 */
export function registerSkillsCommands(program: Command): void {
  const skillsCommand = program.command('skills').description('Manage skills');

  // 列出所有技能
  skillsCommand
    .command('list')
    .description('List all available skills')
    .option('-s, --source <source>', 'Filter skills by source')
    .option('-i, --invocable', 'Only show user invocable skills')
    .action(async (options: any) => {
      try {
        console.log(chalk.blue('Loading skills...'));
        const registry = await loadAllSkills();

        let skills = registry.getAll();

        // 按来源过滤
        if (options.source) {
          skills = skills.filter((s) => s.source === options.source);
        }

        // 按可调用性过滤
        if (options.invocable) {
          skills = skills.filter((s) => s.userInvocable !== false);
        }

        if (skills.length === 0) {
          console.log(chalk.yellow('No skills found.'));
          return;
        }

        console.log(chalk.bold('Available skills:'));
        console.log(chalk.cyan('═'.repeat(80)));
        skills.forEach((skill) => {
          console.log(chalk.green(`Name: ${skill.name}`));
          console.log(chalk.blue(`Description: ${skill.description}`));
          console.log(chalk.yellow(`Source: ${skill.source}`));
          console.log(
            chalk.cyan(
              `User invocable: ${skill.userInvocable !== false ? 'Yes' : 'No'}`
            )
          );
          console.log(chalk.cyan('─'.repeat(80)));
        });
        console.log(chalk.bold(`Total skills: ${skills.length}`));
      } catch (error) {
        console.error(
          chalk.red(
            `Error listing skills: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        // @ignore-catch — CLI 命令失败，不预期抛出中断程序
        await handleError(error, { module: 'skills:cli', action: 'list' });
      }
    });

  // 查看技能详情
  skillsCommand
    .command('info <skill-name>')
    .description('Show skill details')
    .action(async (skillName: string) => {
      try {
        console.log(chalk.blue(`Loading skill details for ${skillName}...`));
        const registry = await loadAllSkills();

        const skill = registry.get(skillName);

        if (!skill) {
          console.log(chalk.red(`Skill not found: ${skillName}`));
          return;
        }

        console.log(chalk.bold('Skill details:'));
        console.log(chalk.cyan('═'.repeat(80)));
        console.log(chalk.green(`Name: ${skill.name}`));
        console.log(chalk.blue(`Description: ${skill.description}`));
        console.log(chalk.yellow(`Source: ${skill.source}`));
        console.log(chalk.yellow(`Loaded from: ${skill.loadedFrom}`));
        console.log(chalk.cyan(`Load method: ${skill.loadMethod}`));
        console.log(
          chalk.cyan(
            `Kind: ${skill.impl.kind === 'prompt' ? 'Prompt' : 'Executable'}`
          )
        );
        console.log(
          chalk.cyan(
            `User invocable: ${skill.userInvocable !== false ? 'Yes' : 'No'}`
          )
        );
        console.log(
          chalk.cyan(
            `Allowed tools: ${skill.allowedTools && skill.allowedTools.length > 0 ? skill.allowedTools.join(', ') : 'None'}`
          )
        );
        console.log(
          chalk.cyan(`Argument hint: ${skill.argumentHint || 'None'}`)
        );
        console.log(chalk.cyan(`When to use: ${skill.whenToUse || 'None'}`));
        console.log(chalk.cyan(`Version: ${skill.version || 'None'}`));
        console.log(chalk.cyan(`Model: ${skill.model || 'None'}`));
        console.log(chalk.cyan(`Effort: ${skill.effort || 'None'}`));
        console.log(
          chalk.cyan(`Paths: ${skill.paths ? skill.paths.join(', ') : 'None'}`)
        );
        console.log(
          chalk.cyan(`Content length: ${skill.contentLength || 0} characters`)
        );
        console.log(chalk.cyan('═'.repeat(80)));
      } catch (error) {
        console.error(
          chalk.red(
            `Error getting skill info: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        // @ignore-catch — CLI 命令失败，不预期抛出中断程序
        await handleError(error, { module: 'skills:cli', action: 'info' });
      }
    });

  // 执行技能
  skillsCommand
    .command('run <skill-name> [arguments...]')
    .description('Run a skill')
    .action(async (skillName: string, args: string[]) => {
      try {
        console.log(chalk.blue(`Running skill: ${skillName}`));
        if (args.length > 0) {
          console.log(chalk.yellow(`Arguments: ${args.join(' ')}`));
        }

        const registry = await loadAllSkills();
        const skill = registry.get(skillName);

        if (!skill) {
          console.log(chalk.red(`Skill not found: ${skillName}`));
          return;
        }

        // 解析参数
        const parsedArgs = parseArguments(args);

        // 根据受歧视联合路由
        console.log(chalk.blue('Executing skill...'));

        if (skill.impl.kind === 'executable') {
          const result = await skill.impl.execute(parsedArgs);
          console.log(chalk.bold('Skill execution result:'));
          console.log(chalk.cyan('═'.repeat(80)));
          console.log(chalk.green(JSON.stringify(result, null, 2)));
        } else {
          const prompt = await skill.impl.getPromptForCommand(parsedArgs, {});
          console.log(chalk.bold('Skill prompt:'));
          console.log(chalk.cyan('═'.repeat(80)));
          console.log(chalk.green(JSON.stringify(prompt, null, 2)));
        }

        console.log(chalk.cyan('═'.repeat(80)));
      } catch (error) {
        console.error(
          chalk.red(
            `Error running skill: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        // @ignore-catch — CLI 命令失败，不预期抛出中断程序
        await handleError(error, { module: 'skills:cli', action: 'run' });
      }
    });

  // 重新加载技能
  skillsCommand
    .command('reload')
    .description('Reload skills')
    .action(async () => {
      try {
        console.log(chalk.blue('Reloading skills...'));
        const registry = await loadAllSkills();
        const skills = registry.getAll();
        console.log(
          chalk.green(`Successfully reloaded ${skills.length} skills.`)
        );
      } catch (error) {
        console.error(
          chalk.red(
            `Error reloading skills: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        // @ignore-catch — CLI 命令失败，不预期抛出中断程序
        await handleError(error, { module: 'skills:cli', action: 'reload' });
      }
    });
}

/**
 * 解析命令行参数
 * @param args 命令行参数数组
 * @returns 解析后的参数对象
 */
function parseArguments(args: string[]): any {
  const parsed: any = {};

  for (const arg of args) {
    if (arg.includes('=')) {
      const [key, value] = arg.split('=');
      parsed[key] = value;
    } else {
      // 位置参数
      const index = Object.keys(parsed).length;
      parsed[`arg${index + 1}`] = arg;
    }
  }

  return parsed;
}
