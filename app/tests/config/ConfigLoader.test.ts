// MIT License
// Copyright (c) 2026 190615273@qq.com
// ConfigLoader YAML 解析单测（P0-1 嵌套支持升级）

import { describe, expect, it } from 'bun:test';
import { ConfigLoader } from '../../src/config/loader/ConfigLoader';

const loader = new ConfigLoader();

describe('ConfigLoader.parseYaml（嵌套支持，2026-08-25 升级）', () => {
  it('解析三层嵌套结构（bundle ai.yaml 场景）', () => {
    const yaml = `
name: ai
description: AI 模型与提供商配置
config:
  ai:
    defaultModel: deepseek-chat
    providers: [providerId]
  routing:
    fallback: true
`;
    const parsed = loader.parse(yaml, 'yaml');
    expect(parsed.name).toBe('ai');
    expect(parsed.config).toEqual({
      ai: { defaultModel: 'deepseek-chat', providers: ['providerId'] },
      routing: { fallback: true },
    });
  });

  it('扁平 key:value 向后兼容', () => {
    const yaml = 'logging.level: info\nserver.port: 8080\n';
    const parsed = loader.parse(yaml, 'yaml');
    expect(parsed).toEqual({ 'logging.level': 'info', 'server.port': 8080 });
  });

  it('标量类型推断（数字/布尔/null/字符串）', () => {
    const yaml = `
int: 42
float: 3.14
bool: true
nullv: null
str: hello
quoted: "hello world"
`;
    const parsed = loader.parse(yaml, 'yaml');
    expect(parsed.int).toBe(42);
    expect(parsed.float).toBe(3.14);
    expect(parsed.bool).toBe(true);
    expect(parsed.nullv).toBeNull();
    expect(parsed.str).toBe('hello');
    expect(parsed.quoted).toBe('hello world');
  });

  it('数组与嵌套数组', () => {
    const yaml = `
bundles:
  - core
  - chat
matrix:
  - [1, 2]
  - [3, 4]
`;
    const parsed = loader.parse(yaml, 'yaml');
    expect(parsed.bundles).toEqual(['core', 'chat']);
    expect(parsed.matrix).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('空文档与注释返回空对象', () => {
    const parsed = loader.parse('# 仅注释\n\n', 'yaml');
    expect(parsed).toEqual({});
  });

  it('顶层非 mapping（数组）抛错', () => {
    expect(() => loader.parse('- a\n- b\n', 'yaml')).toThrow(/top-level must be a mapping/);
  });

  it('非法 YAML 抛错', () => {
    expect(() => loader.parse('key: [unclosed\n', 'yaml')).toThrow();
  });
});
