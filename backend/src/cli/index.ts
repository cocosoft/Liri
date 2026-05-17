#!/usr/bin/env bun
/**
 * PY_APP CLI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import { initHooksCommand } from '../hooks/cli/hooks';
import { getHelpSystem } from '../docs/HelpSystem';
import { getToolGuideSystem } from '../docs/ToolGuide';
import { getPluginDevGuideSystem } from '../docs/PluginDevGuide';
import { getApiDocSystem } from '../docs/ApiDocs';
import { getPerformanceAnalyzer } from '../monitoring/performance';
import { getThemeManager } from '../core/theme';
import { createCLIHandler } from './handlers/cliHandler';
import { createRemoteIO } from './remoteIO';
import { createStructuredIO } from './structuredIO';
import { createExitHandler } from './exitHandler';
import { createAutoUpdater } from './autoUpdater';
import { registerSkillsCommands } from '../skills/cli/skills';
import { UpdateHandler } from './update';
import * as print from './print';

/** 动态加载的命令模块接口 */
interface CommandModule {
  execute: (...args: string[]) => { message: string };
}

// 初始化退出处理器和自动更新器
const exitHandler = createExitHandler({ verbose: true });
const autoUpdater = createAutoUpdater({ verbose: true });

// 进度条函数
function showProgress(current: number, total: number, message: string): void {
  const percent = Math.round((current / total) * 100);
  const barLength = 40;
  const filledLength = Math.round((percent / 100) * barLength);
  const bar = '█'.repeat(filledLength) + ' '.repeat(barLength - filledLength);
  process.stdout.write(`\r${chalk.blue(`[${bar}] ${percent}%`)} ${message}`);
  if (current === total) {
    process.stdout.write('\n');
  }
}

// 延迟函数
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const program = new Command();

program.name('PY_APP').description('Py_APP - AI Agent').version('1.0.0');

program
  .command('help [command]')
  .description('Show help information')
  .action((commandName: string | undefined) => {
    const helpSystem = getHelpSystem();

    if (commandName) {
      if (
        commandName.startsWith('tool-') ||
        helpSystem.getToolHelp(commandName)
      ) {
        const toolName = commandName.startsWith('tool-')
          ? commandName.replace('tool-', '')
          : commandName;
        helpSystem.displayToolHelp(toolName);
      } else {
        helpSystem.displayCommandHelp(commandName);
      }
    } else {
      helpSystem.displayFullHelp();
    }
  });

program
  .command('hello')
  .description('Show welcome message')
  .action(() => {
    console.log(chalk.green('✓'), 'Py_APP is running!');
    console.log(chalk.blue('ℹ'), 'Available: chat, read, search, exec, status');
    console.log(chalk.gray('  Use --help for all commands'));
  });

program
  .command('status')
  .description('Show project status')
  .action(() => {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  PY_APP - Status'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    console.log(chalk.green('✓'), 'Core Engine');
    console.log(chalk.green('✓'), 'Tool Registry');
    console.log(chalk.green('✓'), 'CLI Interface');
    console.log(chalk.green('✓'), 'Hook System');
    console.log();
    console.log(chalk.green('✓'), 'Basic Functions');
    console.log('  • hello    - Welcome message');
    console.log('  • status   - Project status');
    console.log('  • version  - Version info');
    console.log();
    console.log(chalk.green('✓'), 'File Operations');
    console.log('  • read     - Read file content');
    console.log('  • search   - Search in files');
    console.log('  • list     - List directory');
    console.log();
    console.log(chalk.green('✓'), 'Command Execution');
    console.log('  • exec     - Execute shell command');
    console.log();
    console.log(chalk.cyan('─'.repeat(60)));
    console.log(chalk.gray('Tip: Use --help for detailed usage'));
    console.log(chalk.cyan('═'.repeat(60)));
  });

// ========== File Operations ==========

program
  .command('read <file>')
  .description('Read file content')
  .option('-l, --lines <number>', 'Show first N lines', '50')
  .action((filePath: string, options: { lines: string }) => {
    try {
      const resolvedPath = resolve(filePath);

      if (!existsSync(resolvedPath)) {
        console.error(chalk.red('✗'), `File not found: ${filePath}`);
        process.exit(1);
      }

      const content = readFileSync(resolvedPath, 'utf-8');
      const lines = content.split('\n');
      const maxLines = parseInt(options.lines, 10);

      console.log(chalk.cyan('─'.repeat(60)));
      console.log(chalk.bold(`File: ${filePath}`));
      console.log(chalk.cyan('─'.repeat(60)));

      lines.slice(0, maxLines).forEach((line, index) => {
        console.log(chalk.gray(`${String(index + 1).padStart(4)} |`), line);
      });

      if (lines.length > maxLines) {
        console.log(chalk.gray('     |'));
        console.log(chalk.yellow(`... ${lines.length - maxLines} more lines`));
      }

      console.log(chalk.cyan('─'.repeat(60)));
    } catch (error: unknown) {
      const e = error as Error;
      console.error(chalk.red('✗'), `Read failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('list [directory]')
  .description('List directory contents')
  .option('-a, --all', 'Show all files including hidden', false)
  .action((dirPath: string = '.', options: { all: boolean }) => {
    try {
      const resolvedPath = resolve(dirPath);

      if (!existsSync(resolvedPath)) {
        console.error(chalk.red('✗'), `Directory not found: ${dirPath}`);
        process.exit(1);
      }

      const items = readdirSync(resolvedPath);

      console.log(chalk.cyan('─'.repeat(60)));
      console.log(chalk.bold(`Directory: ${resolvedPath}`));
      console.log(chalk.cyan('─'.repeat(60)));

      items.forEach((item) => {
        if (!options.all && item.startsWith('.')) return;

        const fullPath = join(resolvedPath, item);
        const stats = statSync(fullPath);
        const isDir = stats.isDirectory();
        const icon = isDir ? chalk.blue('[DIR]') : chalk.gray('[FILE]');
        const name = isDir ? chalk.blue.bold(item) : item;
        const size = isDir ? '' : formatFileSize(stats.size);

        console.log(`  ${icon} ${name.padEnd(30)} ${chalk.gray(size)}`);
      });

      console.log(chalk.cyan('─'.repeat(60)));
    } catch (error: unknown) {
      const e = error as Error;
      console.error(chalk.red('✗'), `List failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('search <pattern>')
  .description('Search content in files')
  .option('-d, --directory <path>', 'Search directory', '.')
  .option('-i, --ignore-case', 'Ignore case', false)
  .action(
    (pattern: string, options: { directory: string; ignoreCase: boolean }) => {
      try {
        const resolvedPath = resolve(options.directory);

        console.log(chalk.cyan('─'.repeat(60)));
        console.log(chalk.bold(`Search: "${pattern}"`));
        console.log(chalk.gray(`   in: ${resolvedPath}`));
        console.log(chalk.cyan('─'.repeat(60)));

        const results = searchInDirectory(
          resolvedPath,
          pattern,
          options.ignoreCase
        );

        if (results.length === 0) {
          console.log(chalk.yellow('⚠'), 'No matches found');
        } else {
          results.slice(0, 20).forEach((result) => {
            console.log(chalk.green(`  ${result.file}:${result.line}`));
            console.log(
              `    ${highlightMatch(result.content, pattern, options.ignoreCase)}`
            );
          });

          if (results.length > 20) {
            console.log(
              chalk.yellow(`\n... and ${results.length - 20} more results`)
            );
          }
        }

        console.log(chalk.cyan('─'.repeat(60)));
      } catch (error: unknown) {
        console.error(
          chalk.red('✗'),
          `Search failed: ${(error as Error).message}`
        );
        process.exit(1);
      }
    }
  );

// ========== Command Execution ==========

program
  .command('exec <command>')
  .description('Execute shell command')
  .option('-d, --directory <path>', 'Working directory', '.')
  .action((command: string, options: { directory: string }) => {
    try {
      console.log(chalk.cyan('─'.repeat(60)));
      console.log(chalk.bold('Execute Command'));
      console.log(chalk.gray(`$ ${command}`));
      console.log(chalk.cyan('─'.repeat(60)));

      const result = execSync(command, {
        cwd: resolve(options.directory),
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      console.log(result);
      console.log(chalk.cyan('─'.repeat(60)));
      console.log(chalk.green('✓'), 'Command executed successfully');
    } catch (error: unknown) {
      const execErr = error as Record<string, unknown>;
      console.error(chalk.red('✗'), `Execution failed:`);
      if (execErr.stdout) console.log((execErr.stdout as Buffer).toString());
      if (execErr.stderr) console.error((execErr.stderr as Buffer).toString());
      process.exit(1);
    }
  });

// ========== File Operations Extended ==========

program
  .command('write <file> <content>')
  .description('Write content to file')
  .option('-f, --force', 'Overwrite existing file', false)
  .action((filePath: string, content: string, options: { force: boolean }) => {
    try {
      const resolvedPath = resolve(filePath);

      if (existsSync(resolvedPath) && !options.force) {
        console.error(chalk.red('✗'), `File already exists: ${filePath}`);
        console.error(chalk.gray('  Use --force to overwrite'));
        process.exit(1);
      }

      console.log(chalk.cyan('─'.repeat(60)));
      console.log(chalk.bold(`Write to: ${filePath}`));
      console.log(chalk.cyan('─'.repeat(60)));

      // 显示进度
      showProgress(0, 100, 'Preparing...');
      delay(100);
      showProgress(50, 100, 'Writing content...');

      writeFileSync(resolvedPath, content, 'utf-8');

      showProgress(100, 100, 'Write completed');

      console.log(chalk.green('✓'), 'File written successfully');
      console.log(chalk.cyan('─'.repeat(60)));
    } catch (error: unknown) {
      const e = error as Error;
      console.error(
        chalk.red('✗'),
        `Write failed: ${(error as Error).message}`
      );
      process.exit(1);
    }
  });

program
  .command('edit <file> <oldString> <newString>')
  .description('Edit file content')
  .action((filePath: string, oldString: string, newString: string) => {
    try {
      const resolvedPath = resolve(filePath);

      if (!existsSync(resolvedPath)) {
        console.error(chalk.red('✗'), `File not found: ${filePath}`);
        process.exit(1);
      }

      console.log(chalk.cyan('─'.repeat(60)));
      console.log(chalk.bold(`Edit: ${filePath}`));
      console.log(chalk.cyan('─'.repeat(60)));

      const content = readFileSync(resolvedPath, 'utf-8');

      if (!content.includes(oldString)) {
        console.error(chalk.red('✗'), 'Old string not found in file');
        process.exit(1);
      }

      // 显示进度
      showProgress(0, 100, 'Reading file...');
      delay(100);
      showProgress(50, 100, 'Replacing content...');

      const newContent = content.replace(oldString, newString);
      writeFileSync(resolvedPath, newContent, 'utf-8');

      showProgress(100, 100, 'Edit completed');

      console.log(chalk.green('✓'), 'File edited successfully');
      console.log(chalk.cyan('─'.repeat(60)));
    } catch (error: unknown) {
      const e = error as Error;
      console.error(chalk.red('✗'), `Edit failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('glob <pattern>')
  .description('Match files using glob pattern')
  .action((pattern: string) => {
    try {
      console.log(chalk.cyan('─'.repeat(60)));
      console.log(chalk.bold(`Glob: ${pattern}`));
      console.log(chalk.cyan('─'.repeat(60)));

      // 显示进度
      showProgress(0, 100, 'Searching files...');

      const files = findFilesByPattern(pattern);

      showProgress(100, 100, `Found ${files.length} files`);

      if (files.length === 0) {
        console.log(chalk.yellow('⚠'), 'No files matching pattern');
      } else {
        files.forEach((file) => {
          console.log(chalk.green('  ✓'), file);
        });
      }

      console.log(chalk.cyan('─'.repeat(60)));
    } catch (error: unknown) {
      const e = error as Error;
      console.error(chalk.red('✗'), `Glob failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// 初始化Hook命令
initHooksCommand(program);

// ========== Tool Chain Commands ==========

program
  .command('tools')
  .description('List all available tools')
  .action(async () => {
    try {
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  Available Tools'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();

      // 动态导入工具管理器
      const { createToolManager } = await import('../tools/ToolManager');
      const toolManager = createToolManager();

      const tools = toolManager.getAllTools();

      if (tools.length === 0) {
        console.log(chalk.yellow('⚠'), 'No tools available');
      } else {
        tools.forEach((tool, index) => {
          console.log(
            chalk.green(`${String(index + 1).padStart(2)}.`),
            chalk.bold(tool.name)
          );
          console.log(`   ${chalk.gray(tool.description)}`);
          if (tool.aliases && tool.aliases.length > 0) {
            console.log(
              `   ${chalk.gray('Aliases:')} ${tool.aliases.join(', ')}`
            );
          }
          console.log();
        });
      }

      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error: unknown) {
      const e = error as Error;
      console.error(
        chalk.red('✗'),
        `Failed to list tools: ${(error as Error).message}`
      );
      process.exit(1);
    }
  });

program
  .command('tool <name>')
  .description('Show tool details')
  .action(async (name: string) => {
    try {
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold(`  Tool Details: ${name}`));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();

      // 动态导入工具管理器
      const { createToolManager } = await import('../tools/ToolManager');
      const toolManager = createToolManager();

      const tool = toolManager.getTool(name);

      if (!tool) {
        console.error(chalk.red('✗'), `Tool not found: ${name}`);
        process.exit(1);
      }

      console.log(chalk.green('Name:'), chalk.bold(tool.name));
      console.log(chalk.green('Description:'), tool.description);
      if (tool.aliases && tool.aliases.length > 0) {
        console.log(chalk.green('Aliases:'), tool.aliases.join(', '));
      }
      console.log(
        chalk.green('Enabled:'),
        tool.isEnabled() ? chalk.green('Yes') : chalk.red('No')
      );
      console.log(
        chalk.green('Read-only:'),
        tool.isReadOnly() ? chalk.yellow('Yes') : chalk.green('No')
      );
      console.log(
        chalk.green('Concurrency safe:'),
        tool.isConcurrencySafe() ? chalk.green('Yes') : chalk.yellow('No')
      );
      console.log(
        chalk.green('Max result size:'),
        tool.maxResultSizeChars,
        'chars'
      );

      if (tool.params && tool.params.length > 0) {
        console.log();
        console.log(chalk.green('Parameters:'));
        tool.params.forEach((param) => {
          console.log(`  • ${chalk.bold(param.name)} (${param.type})`);
          console.log(
            `    ${chalk.gray(param.description || 'No description')}`
          );
          if (param.required) {
            console.log(`    ${chalk.yellow('Required')}`);
          }
          if (param.default !== undefined) {
            console.log(`    ${chalk.gray('Default:')} ${param.default}`);
          }
        });
      }

      console.log();
      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error: unknown) {
      const e = error as Error;
      console.error(
        chalk.red('✗'),
        `Failed to show tool details: ${(error as Error).message}`
      );
      process.exit(1);
    }
  });

program
  .command('skill')
  .description('Manage skills')
  .action(async () => {
    try {
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  Skill Management'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();

      // 动态导入技能管理器
      const { skillManager } = await import('../skills/managers/SkillManager');

      const skills = skillManager.getSkills();

      if (skills.length === 0) {
        console.log(chalk.yellow('⚠'), 'No skills available');
      } else {
        console.log(chalk.green('Available skills:'));
        console.log();
        skills.forEach((skill, index) => {
          console.log(
            chalk.green(`${String(index + 1).padStart(2)}.`),
            chalk.bold(skill.name)
          );
          console.log(`   ${chalk.gray(skill.description)}`);
          if (skill.argumentHint) {
            console.log(
              `   ${chalk.gray('Usage:')} ${skill.name} ${skill.argumentHint}`
            );
          }
          console.log();
        });
      }

      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error: unknown) {
      const e = error as Error;
      console.error(
        chalk.red('✗'),
        `Failed to manage skills: ${(error as Error).message}`
      );
      process.exit(1);
    }
  });

// ========== Auth Commands ==========

const cliHandler = createCLIHandler({
  verbose: process.env.VERBOSE === 'true',
});

program
  .command('login [username]')
  .description('Login to PY_APP')
  .action(async (username?: string) => {
    await cliHandler.execute(`login ${username || ''}`);
  });

program
  .command('logout')
  .description('Logout from PY_APP')
  .action(async () => {
    await cliHandler.execute('logout');
  });

program
  .command('auth-status')
  .description('Check authentication status')
  .action(async () => {
    await cliHandler.execute('status');
  });

program
  .command('refresh-token')
  .description('Refresh authentication token')
  .action(async () => {
    await cliHandler.execute('refresh');
  });

// ========== Agent Commands ==========

program
  .command('agent list')
  .description('List all agents')
  .action(async () => {
    await cliHandler.execute('agents list');
  });

program
  .command('agent start <name>')
  .description('Start an agent')
  .action(async (name: string) => {
    await cliHandler.execute(`agents start ${name}`);
  });

program
  .command('agent stop <name>')
  .description('Stop an agent')
  .action(async (name: string) => {
    await cliHandler.execute(`agents stop ${name}`);
  });

program
  .command('agent restart <name>')
  .description('Restart an agent')
  .action(async (name: string) => {
    await cliHandler.execute(`agents restart ${name}`);
  });

program
  .command('agent create <name> [type]')
  .description('Create a new agent')
  .action(async (name: string, type?: string) => {
    await cliHandler.execute(`agents create ${name} ${type || ''}`);
  });

// ========== MCP Commands ==========

program
  .command('mcp list')
  .description('List all MCP servers')
  .action(async () => {
    await cliHandler.execute('mcp list');
  });

program
  .command('mcp connect <name> [url]')
  .description('Connect to an MCP server')
  .action(async (name: string, url?: string) => {
    await cliHandler.execute(`mcp connect ${name} ${url || ''}`);
  });

program
  .command('mcp disconnect <name>')
  .description('Disconnect from an MCP server')
  .action(async (name: string) => {
    await cliHandler.execute(`mcp disconnect ${name}`);
  });

program
  .command('mcp')
  .description('Manage MCP connections')
  .action(async () => {
    try {
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  MCP Management'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();

      console.log(chalk.green('MCP (Model Context Protocol)'));
      console.log(chalk.gray('Connect to external tools and services'));
      console.log();
      console.log(chalk.yellow('Available actions:'));
      console.log('  • list   - List available MCP servers');
      console.log('  • connect - Connect to an MCP server');
      console.log('  • disconnect - Disconnect from an MCP server');
      console.log();

      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error: unknown) {
      const e = error as Error;
      console.error(
        chalk.red('✗'),
        `Failed to manage MCP: ${(error as Error).message}`
      );
      process.exit(1);
    }
  });

program
  .command('lsp')
  .description('Manage LSP services')
  .action(async () => {
    try {
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  LSP Management'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();

      console.log(chalk.green('LSP (Language Server Protocol)'));
      console.log(chalk.gray('Code intelligence and language services'));
      console.log();
      console.log(chalk.yellow('Available features:'));
      console.log('  • code completion');
      console.log('  • go to definition');
      console.log('  • find references');
      console.log('  • diagnostics');
      console.log();

      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error: unknown) {
      const e = error as Error;
      console.error(
        chalk.red('✗'),
        `Failed to manage LSP: ${(error as Error).message}`
      );
      process.exit(1);
    }
  });

program
  .command('tool-guide [toolName]')
  .description('Show tool usage guide')
  .action((toolName: string | undefined) => {
    const guideSystem = getToolGuideSystem();

    if (toolName) {
      guideSystem.displayToolGuide(toolName);
    } else {
      guideSystem.displayToolList();
    }
  });

program
  .command('plugin-guide')
  .description('Show plugin development guide')
  .action(() => {
    const guideSystem = getPluginDevGuideSystem();
    guideSystem.displayDevGuide();
  });

program
  .command('plugin-template [templateName]')
  .description('Show plugin template')
  .action((templateName: string | undefined) => {
    const guideSystem = getPluginDevGuideSystem();

    if (templateName) {
      guideSystem.displayTemplate(templateName);
    } else {
      guideSystem.displayQuickRef();
    }
  });

program
  .command('api-doc [apiName]')
  .description('Show API documentation')
  .action((apiName: string | undefined) => {
    const docSystem = getApiDocSystem();

    if (apiName) {
      docSystem.displayApiDoc(apiName);
    } else {
      docSystem.displayApiList();
    }
  });

program
  .command('performance [action]')
  .description('Manage performance analysis')
  .action((action: string | undefined) => {
    const analyzer = getPerformanceAnalyzer();

    if (action === 'report') {
      const report = analyzer.generateReport();
      analyzer.displayReport(report);
    } else if (action === 'snapshot') {
      const snapshot = analyzer.getSnapshot();
      console.log(chalk.green('Performance Snapshot:'));
      console.log(`  Active Operations: ${snapshot.activeOperations}`);
      console.log(`  Completed Operations: ${snapshot.completedOperations}`);
      console.log(
        `  Average Duration: ${Math.round(snapshot.averageDuration)}ms`
      );
      console.log(
        `  Memory RSS: ${Math.round(snapshot.memory.rss / 1024 / 1024)}MB`
      );
      console.log(
        `  Memory Heap: ${Math.round(snapshot.memory.heapUsed / 1024 / 1024)}MB`
      );
    } else if (action === 'clear') {
      analyzer.clearHistory();
      console.log(chalk.green('Performance history cleared'));
    } else {
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  Performance Commands'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();
      console.log('  performance report    - Generate performance report');
      console.log('  performance snapshot - Get current performance snapshot');
      console.log('  performance clear    - Clear performance history');
      console.log();
      console.log(
        chalk.gray(
          'Tracking ' +
            analyzer.getActiveOperationCount() +
            ' active operations'
        )
      );
      console.log(
        chalk.gray('Total completed: ' + analyzer.getCompletedOperationCount())
      );
      console.log(chalk.cyan('═'.repeat(60)));
    }
  });

program
  .command('theme [action] [themeName]')
  .description('Manage themes')
  .action((action: string | undefined, themeName: string | undefined) => {
    const themeManager = getThemeManager();

    if (action === 'list') {
      themeManager.displayThemes();
    } else if (action === 'set' && themeName) {
      if (themeManager.setTheme(themeName)) {
        console.log(chalk.green(`Theme set to: ${themeName}`));
      } else {
        console.log(chalk.red(`Failed to set theme: ${themeName}`));
      }
    } else if (action === 'info') {
      themeManager.displayCurrentTheme();
    } else if (action === 'toggle') {
      themeManager.toggleTheme();
      console.log(
        chalk.green(`Theme toggled to: ${themeManager.getCurrentTheme().name}`)
      );
    } else {
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  Theme Commands'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();
      console.log('  theme list            - List all available themes');
      console.log('  theme set <name>      - Set theme by name');
      console.log('  theme info            - Show current theme details');
      console.log('  theme toggle          - Toggle between themes');
      console.log();
      console.log(
        chalk.gray('Available themes: light, dark, monokai, solarized, dracula')
      );
      console.log(chalk.cyan('═'.repeat(60)));
    }
  });

// ========== Skills Commands (Commander) ==========

registerSkillsCommands(program);

// ========== Update Commands ==========

const updateHandler = new UpdateHandler({ verbose: false });

program
  .command('update')
  .description('Check for updates and manage application updates')
  .option('-c, --check', 'Check for updates')
  .option('-i, --install', 'Install available updates')
  .option('-f, --force', 'Force update even if no updates available')
  .action(
    async (options: {
      check?: boolean;
      install?: boolean;
      force?: boolean;
    }) => {
      if (options.install || options.force) {
        await updateHandler.handleInstall(options.force ? ['--force'] : []);
      } else {
        await updateHandler.handleCheck();
      }
    }
  );

program
  .command('update check')
  .description('Check for available updates')
  .action(async () => {
    await updateHandler.handleCheck();
  });

program
  .command('update install')
  .description('Install the latest update')
  .option('-f, --force', 'Force installation')
  .action(async (options: { force?: boolean }) => {
    await updateHandler.handleInstall(options.force ? ['--force'] : []);
  });

// ========== Docs Commands ==========

program
  .command('docs [topic]')
  .description('View documentation')
  .option('-s, --search <query>', 'Search documentation')
  .option('-l, --list', 'List all documentation sections')
  .action(
    async (
      topic: string | undefined,
      options: { search?: string; list?: boolean }
    ) => {
      try {
        const { docsCommand } =
          await import('../commands/builtin/docs/index.js');

        if (options.search) {
          const result = await docsCommand.load!().then((m: CommandModule) =>
            m.execute(`search ${options.search}`, '')
          );
          console.log(result.message);
        } else if (options.list) {
          const result = await docsCommand.load!().then((m: CommandModule) =>
            m.execute('list', '')
          );
          console.log(result.message);
        } else if (topic) {
          const result = await docsCommand.load!().then((m: CommandModule) =>
            m.execute(topic, '')
          );
          console.log(result.message);
        } else {
          const result = await docsCommand.load!().then((m: CommandModule) =>
            m.execute('', '')
          );
          console.log(result.message);
        }
      } catch (error: unknown) {
        console.error(
          chalk.red('✗'),
          `Docs command failed: ${(error as Error).message}`
        );
      }
    }
  );

// ========== Uninstall Commands ==========

program
  .command('uninstall <type> [name]')
  .description('Uninstall plugins, skills, tools, themes, or agents')
  .option('--confirm', 'Confirm uninstallation')
  .option('--force', 'Force uninstallation')
  .action(
    async (
      type: string,
      name: string | undefined,
      options: { confirm?: boolean; force?: boolean }
    ) => {
      try {
        const fullArgs = name
          ? `${type} ${name}${options.force ? ' --force' : options.confirm ? ' --confirm' : ''}`
          : type;

        const { uninstallCommand } =
          await import('../commands/builtin/uninstall/index.js');
        const result = await uninstallCommand.load!().then((m: CommandModule) =>
          m.execute(fullArgs, '')
        );
        console.log(result.message);
      } catch (error: unknown) {
        console.error(
          chalk.red('✗'),
          `Uninstall failed: ${(error as Error).message}`
        );
      }
    }
  );

// ========== Onboard Commands ==========

program
  .command('onboard [action]')
  .description('Application onboarding wizard and quick start guide')
  .action(async (action: string | undefined) => {
    try {
      const { onboardCommand } =
        await import('../commands/builtin/onboard/index.js');

      const args = action || '';
      const result = await onboardCommand.load!().then((m: CommandModule) =>
        m.execute(args, '')
      );
      console.log(result.message);
    } catch (error: unknown) {
      console.error(
        chalk.red('✗'),
        `Onboard command failed: ${(error as Error).message}`
      );
    }
  });

// ========== Health Commands ==========

program
  .command('health [action]')
  .description('System health check and diagnostics')
  .option('--quick', 'Quick health check')
  .action(async (action: string | undefined, options: { quick?: boolean }) => {
    try {
      const { healthCommand } =
        await import('../commands/builtin/health/index.js');

      const args = options.quick ? 'quick' : action || '';
      const result = await healthCommand.load!().then((m: CommandModule) =>
        m.execute(args, '')
      );
      console.log(result.message);
    } catch (error: unknown) {
      console.error(
        chalk.red('✗'),
        `Health command failed: ${(error as Error).message}`
      );
    }
  });

// ========== Tasks Commands ==========

program
  .command('tasks [action...]')
  .description('Task management (list, add, complete, delete, stats)')
  .action(async (action: string[] | undefined) => {
    try {
      const { tasksCommand } =
        await import('../commands/builtin/tasks/index.js');

      const args = action ? action.join(' ') : '';
      const result = await tasksCommand.load!().then((m: CommandModule) =>
        m.execute(args, '')
      );
      console.log(result.message);
    } catch (error: unknown) {
      console.error(
        chalk.red('✗'),
        `Tasks command failed: ${(error as Error).message}`
      );
    }
  });

// 注册退出处理器
process.on('exit', () => {
  exitHandler.exit(0);
});

process.on('SIGINT', () => {
  exitHandler.exit(0, 'Received SIGINT, exiting...');
});

process.on('SIGTERM', () => {
  exitHandler.exit(0, 'Received SIGTERM, exiting...');
});

if (process.argv.length === 2) {
  console.log(chalk.cyan('═'.repeat(60)));
  console.log(chalk.bold('  PY_APP - AI Agent'));
  console.log(chalk.cyan('═'.repeat(60)));
  console.log();
  program.help();

  // 检查更新（仅在显示帮助时）
  autoUpdater.checkAndNotify().catch(() => {});
}

program.parse();

// ========== Helper Functions ==========

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

interface SearchResult {
  file: string;
  line: number;
  content: string;
}

function searchInDirectory(
  dir: string,
  pattern: string,
  ignoreCase: boolean
): SearchResult[] {
  const results: SearchResult[] = [];
  const flags = ignoreCase ? 'i' : '';
  const regex = new RegExp(pattern, flags);

  function searchFile(filePath: string) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        if (regex.test(line)) {
          results.push({
            file: filePath,
            line: index + 1,
            content: line.trim(),
          });
        }
      });
    } catch {
      // Skip unreadable files
    }
  }

  function traverse(currentDir: string) {
    try {
      const items = readdirSync(currentDir);

      for (const item of items) {
        if (item.startsWith('.') || item === 'node_modules') continue;

        const fullPath = join(currentDir, item);
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
          traverse(fullPath);
        } else if (stats.isFile() && stats.size < 1024 * 1024) {
          searchFile(fullPath);
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  traverse(dir);
  return results;
}

function highlightMatch(
  content: string,
  pattern: string,
  ignoreCase: boolean
): string {
  const flags = ignoreCase ? 'gi' : 'g';
  const regex = new RegExp(`(${pattern})`, flags);
  return content.replace(regex, chalk.yellow('$1'));
}

function findFilesByPattern(pattern: string): string[] {
  const files: string[] = [];
  const basePath = pattern.includes('*') ? pattern.split('*')[0] : '.';
  const resolvedBasePath = resolve(basePath || '.');

  function traverse(currentPath: string) {
    try {
      const items = readdirSync(currentPath);

      for (const item of items) {
        if (item.startsWith('.') || item === 'node_modules') continue;

        const fullPath = join(currentPath, item);
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
          traverse(fullPath);
        } else if (stats.isFile()) {
          // 简单的模式匹配
          if (pattern.includes('*')) {
            const regexPattern = pattern.replace(/\*/g, '.*');
            const regex = new RegExp(regexPattern);
            if (regex.test(fullPath)) {
              files.push(fullPath);
            }
          } else if (fullPath === resolve(pattern)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  traverse(resolvedBasePath);
  return files;
}
