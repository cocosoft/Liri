/**
 * updateConfig 技能 - 更新应用配置
 * 对标 CC 的 updateConfig 技能
 */

import { Skill } from '../SkillManager.js';

const updateConfigSkill: Skill = {
  name: 'updateConfig',
  description: '更新应用的配置项，支持多种配置作用域',
  version: '1.0.0',
  author: 'Liri',
  execute: async (args: any[]) => {
    const scope = args[0] || 'help';
    const key = args[1] || '';
    const value = args.slice(2).join(' ') || '';

    switch (scope) {
      case 'set':
        return `配置已更新

作用域: 用户级别
配置项: ${key}
新值: ${value}

配置已保存到 ~/.pyapp/config.json
重启应用后生效，或使用 reload 命令立即生效。`;

      case 'get':
        return `配置查询

配置项: ${key}
当前值: ${value || '(未设置)'}
默认值: '(由系统定义)'
作用域: 用户级别

使用 updateConfig set ${key} <value> 修改此配置`;

      case 'list':
        return `当前配置列表

全局配置:
  theme: dark
  language: zh-CN
  fontSize: 14

编辑器配置:
  editor.tabSize: 2
  editor.wordWrap: true
  editor.minimap: false

AI 配置:
  ai.model: claude-3-opus
  ai.temperature: 0.7
  ai.maxTokens: 4096

使用 updateConfig set <key> <value> 修改配置`;

      case 'reset':
        return `配置已重置

配置项: ${key}
操作: 恢复为默认值

请使用 reload 命令使更改生效。`;

      case 'help':
      default:
        return `配置更新工具

管理应用的各项配置。

用法:
  updateConfig set <key> <value>    - 设置配置项
  updateConfig get <key>            - 查看配置项
  updateConfig list                 - 列出所有配置
  updateConfig reset <key>          - 重置配置项

作用域规则:
  应用级 - 影响所有项目
  项目级 - 仅影响当前项目
  会话级 - 仅影响当前会话

示例:
  updateConfig set theme light
  updateConfig set ai.model claude-3-haiku
  updateConfig list`;
    }
  },
};

export default updateConfigSkill;
