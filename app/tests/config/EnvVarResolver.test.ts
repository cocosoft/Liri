// MIT License
// Copyright (c) 2026 190615273@qq.com
// EnvVarResolver ${ENV_VAR} 变量替换单测（11.4 / 验收标准 8）

import { describe, expect, it } from 'bun:test';
import { resolveEnvString, resolveEnvVars } from '../../src/config/layers/EnvVarResolver';

const env = { API_KEY: 'sk-123', PORT: '8080' };

describe('resolveEnvString', () => {
  it('基本替换 ${VAR}', () => {
    expect(resolveEnvString('key=${API_KEY}', env, true)).toBe('key=sk-123');
  });

  it('默认值 ${VAR:-default}：变量缺失用默认值', () => {
    expect(resolveEnvString('${MISSING:-fallback}', env, true)).toBe('fallback');
  });

  it('默认值语法：变量存在用变量值', () => {
    expect(resolveEnvString('${API_KEY:-fallback}', env, true)).toBe('sk-123');
  });

  it('缺失变量且无默认值 → fail-fast 抛错', () => {
    expect(() => resolveEnvString('${MISSING}', env, true)).toThrow(
      /环境变量缺失/
    );
  });

  it('fail-open 模式：缺失保留原文', () => {
    expect(resolveEnvString('${MISSING}', env, false)).toBe('${MISSING}');
  });

  it('转义 $${ → 字面 ${（不替换）', () => {
    expect(resolveEnvString('$${API_KEY}', env, true)).toBe('${API_KEY}');
  });

  it('混合文本与多个变量', () => {
    expect(
      resolveEnvString('host:${PORT}/key:${API_KEY}/', env, true)
    ).toBe('host:8080/key:sk-123/');
  });

  it('未闭合 ${ 字面保留', () => {
    expect(resolveEnvString('literal ${unclosed', env, true)).toBe(
      'literal ${unclosed'
    );
  });
});

describe('resolveEnvVars（递归对象）', () => {
  it('嵌套对象/数组/标量替换', () => {
    const config = {
      server: { port: '${PORT}' },
      list: ['${API_KEY}', 'plain'],
      num: 42,
      flag: true,
      nested: { deep: '${API_KEY}' },
    };
    const out = resolveEnvVars(config, { env });
    expect((out.server as { port: string }).port).toBe('8080');
    expect(out.list).toEqual(['sk-123', 'plain']);
    expect(out.num).toBe(42);
    expect(out.flag).toBe(true);
    expect((out.nested as { deep: string }).deep).toBe('sk-123');
  });

  it('不可变：不修改原对象', () => {
    const config = { a: '${API_KEY}' };
    const snapshot = JSON.stringify(config);
    resolveEnvVars(config, { env });
    expect(JSON.stringify(config)).toBe(snapshot);
  });

  it('缺失变量 fail-fast（默认 true）', () => {
    expect(() => resolveEnvVars({ a: '${NOPE}' }, { env })).toThrow(
      /环境变量缺失/
    );
  });
});
