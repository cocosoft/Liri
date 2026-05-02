/**
 * 配置管理模块
 * 负责加载和管理应用配置
 */

import fs from 'fs';
import path from 'path';

/**
 * 配置对象
 */
let config = {};

/**
 * 配置是否已启用
 */
let configEnabled = false;

/**
 * 启用配置
 */
export async function enableConfigs() {
  if (configEnabled) {
    return;
  }

  try {
    // 加载配置文件
    await loadConfig();
    configEnabled = true;
  } catch (error) {
    console.error('Error loading config:', error);
    // 即使配置加载失败，也继续运行
    configEnabled = true;
  }
}

/**
 * 加载配置文件
 */
async function loadConfig() {
  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configContent);
    } catch (error) {
      console.error('Error parsing config file:', error);
      config = {};
    }
  } else {
    // 配置文件不存在，使用默认配置
    config = getDefaultConfig();
    // 保存默认配置
    saveConfig();
  }
}

/**
 * 保存配置
 */
export function saveConfig() {
  try {
    const configPath = getConfigPath();
    const configDir = path.dirname(configPath);

    // 确保配置目录存在
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // 保存配置文件
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.warn('Error saving config:', error);
    // 保存失败不影响应用运行
  }
}

/**
 * 获取配置路径
 */
function getConfigPath() {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  return path.join(homeDir, '.py_app', 'config.json');
}

/**
 * 获取默认配置
 */
function getDefaultConfig() {
  return {
    // 模型配置
    model: {
      default: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 4096,
    },
    // 插件配置
    plugins: {
      enabled: true,
      autoUpdate: true,
    },
    // 技能配置
    skills: {
      enabled: true,
      autoLoad: true,
    },
    // 安全配置
    security: {
      sandbox: {
        enabled: true,
      },
      permissions: {
        mode: 'auto', // auto, manual
      },
    },
    // UI配置
    ui: {
      theme: 'default',
      color: true,
      animations: true,
    },
    // 性能配置
    performance: {
      cache: {
        enabled: true,
        size: 100,
      },
    },
  };
}

/**
 * 获取配置
 */
export function getConfig() {
  return { ...config };
}

/**
 * 获取配置项
 * @param key 配置键路径，如 'model.default'
 * @param defaultValue 默认值
 */
export function getConfigValue(key, defaultValue = undefined) {
  const keys = key.split('.');
  let value = config;

  for (const k of keys) {
    if (value === undefined || value === null) {
      return defaultValue;
    }
    value = value[k];
  }

  return value === undefined ? defaultValue : value;
}

/**
 * 设置配置项
 * @param key 配置键路径，如 'model.default'
 * @param value 配置值
 */
export function setConfigValue(key, value) {
  const keys = key.split('.');
  let current = config;

  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (current[k] === undefined) {
      current[k] = {};
    }
    current = current[k];
  }

  current[keys[keys.length - 1]] = value;
  saveConfig();
}
