/**
 * Chronos CLI命令
 * 定时任务管理命令行工具
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  listAllCronTasks,
  addCronTask,
  removeCronTasks,
} from '@modules/chronos/CronTasks';
import { cronToHuman, parseCronExpression } from '@modules/chronos/cron';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('ChronosCLI');

/**
 * 注册Chronos CLI命令
 * @param program Commander程序实例
 */
export function registerChronosCommands(program: Command): void {
  const chronosCommand = program
    .command('chronos')
    .description('Manage scheduled tasks (Chronos)');

  chronosCommand
    .command('list')
    .description('List all scheduled tasks')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: any) => {
      try {
        const tasks = await listAllCronTasks();

        if (tasks.length === 0) {
          console.log(chalk.yellow('No scheduled tasks found.'));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(tasks, null, 2));
          return;
        }

        console.log(chalk.bold('Scheduled Tasks:'));
        console.log(chalk.cyan('═'.repeat(80)));

        for (const task of tasks) {
          console.log(chalk.green(`ID: ${task.id}`));
          console.log(chalk.blue(`  Cron: ${task.cron}`));
          console.log(chalk.yellow(`  Schedule: ${cronToHuman(task.cron)}`));
          console.log(chalk.cyan(`  Prompt: ${task.prompt}`));
          console.log(chalk.white(`  Recurring: ${task.recurring}`));
          console.log(chalk.white(`  Durable: ${task.durable}`));
          if (task.agentId) {
            console.log(chalk.white(`  Agent ID: ${task.agentId}`));
          }
          console.log(chalk.cyan('─'.repeat(80)));
        }

        console.log(chalk.bold(`Total tasks: ${tasks.length}`));
      } catch (error: any) {
        console.error(chalk.red(`Error listing tasks: ${error.message}`));
      }
    });

  chronosCommand
    .command('create')
    .description('Create a new scheduled task')
    .requiredOption(
      '-c, --cron <expression>',
      'Cron expression (e.g., */5 * * * *)'
    )
    .requiredOption('-p, --prompt <text>', 'Prompt to execute')
    .option('-r, --recurring', 'Set as recurring task', true)
    .option('-d, --durable', 'Persist task to disk', true)
    .option('-a, --agent <id>', 'Agent ID to use')
    .action(async (options: any) => {
      try {
        const cron = options.cron;
        const prompt = options.prompt;
        const recurring = options.recurring ?? true;
        const durable = options.durable ?? true;
        const agentId = options.agent;

        const parsed = parseCronExpression(cron);
        if (!parsed) {
          console.error(chalk.red(`Invalid cron expression: ${cron}`));
          return;
        }

        const id = await addCronTask(cron, prompt, recurring, durable, agentId);

        console.log(chalk.green('✓'), 'Task created successfully!');
        console.log(chalk.bold('Task Details:'));
        console.log(chalk.cyan('═'.repeat(80)));
        console.log(chalk.green(`ID: ${id}`));
        console.log(chalk.blue(`Cron: ${cron}`));
        console.log(chalk.yellow(`Schedule: ${cronToHuman(cron)}`));
        console.log(chalk.cyan(`Prompt: ${prompt}`));
        console.log(chalk.white(`Recurring: ${recurring}`));
        console.log(chalk.white(`Durable: ${durable}`));
        console.log(chalk.cyan('═'.repeat(80)));
      } catch (error: any) {
        console.error(chalk.red(`Error creating task: ${error.message}`));
      }
    });

  chronosCommand
    .command('delete')
    .description('Delete a scheduled task')
    .requiredOption('-i, --id <task-id>', 'Task ID to delete')
    .action(async (options: any) => {
      try {
        const id = options.id;

        const tasks = await listAllCronTasks();
        const task = tasks.find((t) => t.id === id);

        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          return;
        }

        await removeCronTasks([id]);

        console.log(chalk.green('✓'), `Task ${id} deleted successfully!`);
      } catch (error: any) {
        console.error(chalk.red(`Error deleting task: ${error.message}`));
      }
    });

  chronosCommand
    .command('info')
    .description('Show detailed information about a task')
    .requiredOption('-i, --id <task-id>', 'Task ID')
    .action(async (options: any) => {
      try {
        const id = options.id;

        const tasks = await listAllCronTasks();
        const task = tasks.find((t) => t.id === id);

        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          return;
        }

        console.log(chalk.bold('Task Details:'));
        console.log(chalk.cyan('═'.repeat(80)));
        console.log(chalk.green(`ID: ${task.id}`));
        console.log(chalk.blue(`Cron: ${task.cron}`));
        console.log(chalk.yellow(`Schedule: ${cronToHuman(task.cron)}`));
        console.log(chalk.cyan(`Prompt: ${task.prompt}`));
        console.log(chalk.white(`Recurring: ${task.recurring}`));
        console.log(chalk.white(`Durable: ${task.durable}`));
        console.log(chalk.white(`Permanent: ${task.permanent}`));
        console.log(
          chalk.white(`Created: ${new Date(task.createdAt).toLocaleString()}`)
        );
        if (task.agentId) {
          console.log(chalk.white(`Agent ID: ${task.agentId}`));
        }
        if (task.taskType) {
          console.log(chalk.white(`Task Type: ${task.taskType}`));
        }
        if (task.lastFiredAt) {
          console.log(
            chalk.white(
              `Last Run: ${new Date(task.lastFiredAt).toLocaleString()}`
            )
          );
        }
        console.log(chalk.cyan('═'.repeat(80)));
      } catch (error: any) {
        console.error(chalk.red(`Error getting task info: ${error.message}`));
      }
    });
}
