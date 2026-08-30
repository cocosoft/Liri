// MIT License
// Copyright (c) 2026 190615273@qq.com
// ConfigLayersService 单测（步骤 4：env 层解析 + home patch）

import { afterEach, describe, expect, it } from 'bun:test';
import { parseEnvLayer, loadHomePatch } from '../../src/config/layers/ConfigLayersService';

// 清理 PYAPP_* 测试变量
function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('PYAPP_')) delete process.env[k];
  }
});

describe('parseEnvLayer（11.12 定案：__ 嵌套 + 敏感过滤）', () => {
  it('__ 嵌套分隔符：PYAPP_AI__DEFAULTMODEL → ai.defaultModel', () => {
    setEnv('PYAPP_AI__DEFAULTMODEL', 'deepseek-chat');
    const layer = parseEnvLayer();
    expect(layer).toEqual({ ai: { defaultmodel: 'deepseek-chat' } });
  });

  it('大小写归一化 + 标量类型推断', () => {
    setEnv('PYAPP_SERVER__PORT', '8080');
    setEnv('PYAPP_FEATURES__ENABLED', 'true');
    const layer = parseEnvLayer();
    expect(layer).toEqual({ server: { port: 8080 }, features: { enabled: true } });
  });

  it('敏感 key（apiKey/token）跳过', () => {
    setEnv('PYAPP_AI__APIKEY', 'sk-123');
    setEnv('PYAPP_AI__MODEL', 'gpt-4');
    const layer = parseEnvLayer();
    expect((layer.ai as { apiKey?: string }).apiKey).toBeUndefined(); // 敏感跳过
    expect((layer.ai as { model?: string }).model).toBe('gpt-4'); // 非敏感保留
  });

  it('非 PYAPP_ 前缀忽略', () => {
    setEnv('OTHER_VAR', 'x');
    const layer = parseEnvLayer();
    expect(layer).toEqual({});
  });

  it('自定义前缀', () => {
    setEnv('TEST_PREFIX_A', '1');
    const layer = parseEnvLayer('TEST_PREFIX_');
    expect(layer).toEqual({ a: 1 });
  });
});

describe('loadHomePatch', () => {
  it('文件不存在返回空对象', () => {
    const patch = loadHomePatch();
    expect(patch).toEqual({});
  });
});
