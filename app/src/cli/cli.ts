#!/usr/bin/env node
//

import { getUIEnhancer } from '../ui/UIEnhancer';
import { getToolManager } from '../tools/ToolManager';
import { profileReport } from '../performance/StartupProfiler.js';
import { SkillRegistry } from '../skills/SkillRegistry';
import { BundledSkillLoader } from '../skills/loaders/sources/BundledSkillLoader';

const ui = getUIEnhancer();

/**
 * 主菜单选项
 */
const mainMenuOptions = [
  { value: 'skills', label: 'Manage Skills' },
  { value: 'tools', label: 'Manage Tools' },
  { value: 'profile', label: 'View Startup Profile' },
  { value: 'exit', label: 'Exit' },
];

/**
 * 技能菜单选项
 */
const skillsMenuOptions = [
  { value: 'list', label: 'List Skills' },
  { value: 'execute', label: 'Execute Skill' },
  { value: 'reload', label: 'Reload Skills' },
  { value: 'back', label: 'Back to Main Menu' },
];

/**
 * 工具菜单选项
 */
const toolsMenuOptions = [
  { value: 'list', label: 'List Tools' },
  { value: 'back', label: 'Back to Main Menu' },
];

/**
 * 运行CLI
 */
async function runCLI() {
  try {
    // 显示启动信息
    ui.showTitle('Liri Command Line Interface');
    ui.showInfo('Welcome to Liri CLI. Type help for available commands.');
    ui.showSeparator();

    // 初始化技能注册表
    const skillRegistry = new SkillRegistry();
    const bundledLoader = new BundledSkillLoader();
    const bundledSkills = await bundledLoader.loadSkills();
    skillRegistry.registerBatch(bundledSkills);

    const toolManager = getToolManager();

    // 显示主菜单
    await showMainMenu(skillRegistry, toolManager);
  } catch (error) {
    ui.showError(
      `Error starting CLI: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    ui.cleanup();
  }
}

/**
 * 显示主菜单
 */
async function showMainMenu(skillRegistry: SkillRegistry, toolManager: any) {
  while (true) {
    const choice = await ui.showMenu('Main Menu', mainMenuOptions);

    switch (choice) {
      case 'skills':
        await showSkillsMenu(skillRegistry);
        break;
      case 'tools':
        await showToolsMenu(toolManager);
        break;
      case 'profile':
        showProfile();
        break;
      case 'exit':
        ui.showInfo('Exiting Liri CLI...');
        return;
    }
  }
}

/**
 * 显示技能菜单
 */
async function showSkillsMenu(skillRegistry: SkillRegistry) {
  while (true) {
    const choice = await ui.showMenu('Skills Menu', skillsMenuOptions);

    switch (choice) {
      case 'list':
        await listSkills(skillRegistry);
        break;
      case 'execute':
        await executeSkill(skillRegistry);
        break;
      case 'reload':
        await reloadSkills(skillRegistry);
        break;
      case 'back':
        return;
    }
  }
}

/**
 * 显示工具菜单
 */
async function showToolsMenu(toolManager: any) {
  while (true) {
    const choice = await ui.showMenu('Tools Menu', toolsMenuOptions);

    switch (choice) {
      case 'list':
        listTools(toolManager);
        break;
      case 'back':
        return;
    }
  }
}

/**
 * 列出所有技能
 */
async function listSkills(skillRegistry: SkillRegistry) {
  const skills = skillRegistry.getAll();

  if (skills.length === 0) {
    ui.showInfo('No skills found.');
    return;
  }

  ui.showSubtitle('Available Skills');

  for (const skill of skills) {
    ui.showInfo(`Name: ${skill.name}`);
    ui.showInfo(`Description: ${skill.description}`);
    ui.showInfo(`Version: ${skill.version || 'N/A'}`);
    ui.showInfo(`Source: ${skill.source}`);
    ui.showInfo(
      `Kind: ${skill.impl.kind === 'prompt' ? 'Prompt' : 'Executable'}`
    );
    ui.showSeparator();
  }
}

/**
 * 执行技能
 */
async function executeSkill(skillRegistry: SkillRegistry) {
  const skills = skillRegistry.getAll();

  if (skills.length === 0) {
    ui.showInfo('No skills found.');
    return;
  }

  const skillOptions = skills
    .filter((s) => s.userInvocable !== false)
    .map((s) => ({
      value: s.name,
      label: `${s.name} - ${s.description}`,
    }));

  if (skillOptions.length === 0) {
    ui.showInfo('No invocable skills found.');
    return;
  }

  const skillName = await ui.select({
    message: 'Select a skill to execute:',
    options: skillOptions,
  });

  const argsInput = await ui.prompt({
    message: 'Enter arguments (comma-separated):',
    default: '',
  });

  const args = argsInput
    .split(',')
    .map((arg) => arg.trim())
    .filter(Boolean);

  const loading = ui.showLoading(`Executing skill ${skillName}...`);

  try {
    const skill = skillRegistry.get(skillName);
    if (!skill) throw new Error(`Skill ${skillName} not found`);

    let result: unknown;
    if (skill.impl.kind === 'executable') {
      result = await skill.impl.execute(args);
    } else {
      const prompt = await skill.impl.getPromptForCommand(args.join(' '), {});
      result = prompt;
    }

    loading.stop();
    ui.showSuccess(`Skill ${skillName} executed successfully`);
    if (result) {
      ui.showInfo('Result:');
      ui.showCode(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    loading.stop();
    ui.showError(
      `Error executing skill: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 重新加载技能
 */
async function reloadSkills(skillRegistry: SkillRegistry) {
  const loading = ui.showLoading('Reloading skills...');

  try {
    // 重新创建注册表
    skillRegistry.clear();
    const bundledLoader = new BundledSkillLoader();
    const bundledSkills = await bundledLoader.loadSkills();
    skillRegistry.registerBatch(bundledSkills);
    loading.stop();
    ui.showSuccess('Skills reloaded successfully');
  } catch (error) {
    loading.stop();
    ui.showError(
      `Error reloading skills: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 列出所有工具
 */
function listTools(toolManager: any) {
  const tools = toolManager.getTools();

  if (tools.length === 0) {
    ui.showInfo('No tools found.');
    return;
  }

  ui.showSubtitle('Available Tools');

  for (const tool of tools) {
    ui.showInfo(`Name: ${tool.name}`);
    ui.showInfo(`Description: ${tool.description}`);
    ui.showInfo(`Version: ${tool.version || '1.0.0'}`);

    const info = tool.getInfo?.();
    if (info?.tags?.length) {
      ui.showInfo(`Tags: ${info.tags.join(', ')}`);
    }

    ui.showSeparator();
  }
}

/**
 * 显示启动分析报告
 */
function showProfile() {
  ui.showSubtitle('Startup Profile Report');
  profileReport();
  ui.showSeparator();
}

/**
 * 处理命令行参数
 */
function handleCommandLineArgs() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    switch (args[0]) {
      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;
      case 'version':
      case '--version':
      case '-v':
        showVersion();
        break;
      case 'skills':
        if (args[1] === 'list') {
          // 直接列出技能
          const registry = new SkillRegistry();
          const bundledLoader = new BundledSkillLoader();
          bundledLoader.loadSkills().then((skills) => {
            registry.registerBatch(skills);
            listSkills(registry);
            ui.cleanup();
          });
          return;
        }
        break;
      case 'tools':
        if (args[1] === 'list') {
          // 直接列出工具
          const toolManager = getToolManager();
          listTools(toolManager);
          ui.cleanup();
          return;
        }
        break;
      case 'profile':
        // 直接显示分析报告
        showProfile();
        ui.cleanup();
        return;
    }
  }

  // 没有匹配的命令，运行交互式CLI
  runCLI();
}

/**
 * 显示帮助信息
 */
function showHelp() {
  ui.showTitle('Liri CLI Help');
  ui.showInfo('Usage: py-app [command] [options]');
  ui.showSeparator();
  ui.showInfo('Commands:');
  ui.showInfo('  help, --help, -h    Show this help message');
  ui.showInfo('  version, --version, -v    Show version information');
  ui.showInfo('  skills list         List all available skills');
  ui.showInfo('  tools list          List all available tools');
  ui.showInfo('  profile             Show startup profile report');
  ui.showInfo('  (no command)        Run interactive CLI');
  ui.showSeparator();
  ui.showInfo('Website: https://openliri.com');
  ui.cleanup();
}

/**
 * 显示版本信息
 */
function showVersion() {
  const packageJson = require('../../package.json');
  ui.showInfo(`Liri version ${packageJson.version}`);
  ui.cleanup();
}

// 运行CLI
handleCommandLineArgs();
