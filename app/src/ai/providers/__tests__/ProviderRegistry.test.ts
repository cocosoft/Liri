import { describe, expect, test } from 'bun:test';
import { ProviderRegistry } from '../ProviderRegistry';
import type { AIProvider } from '../AIProvider';

function makeProvider(id: string, displayName: string): AIProvider {
  return {
    id,
    displayName,
    chat: async () => ({}),
    chatStream: async function* () {},
    listModels: async () => [],
    validateConfig: () => ({ valid: true }),
  } as unknown as AIProvider;
}

describe('ProviderRegistry.replace — 原子替换', () => {
  test('替换已存在 provider 时覆盖且保留默认 provider（不漂移）', () => {
    const reg = new ProviderRegistry();
    reg.register(makeProvider('db:a', 'A'));
    reg.register(makeProvider('db:b', 'B'));
    expect(reg.getDefaultProvider().id).toBe('db:a');

    reg.replace(makeProvider('db:a', 'A2'));

    expect(reg.get('db:a').displayName).toBe('A2');
    expect(reg.getDefaultProvider().id).toBe('db:a');
  });

  test('替换不存在的 id 时注册为新 provider（已有默认则保持不变）', () => {
    const reg = new ProviderRegistry();
    reg.register(makeProvider('db:a', 'A'));

    reg.replace(makeProvider('db:c', 'C'));

    expect(reg.has('db:c')).toBe(true);
    expect(reg.getDefaultProvider().id).toBe('db:a');
  });

  test('全量同步场景：逐个 replace 后所有 provider 可用且默认保持', () => {
    const reg = new ProviderRegistry();
    reg.register(makeProvider('db:x', 'X'));

    reg.replace(makeProvider('db:y', 'Y'));
    reg.replace(makeProvider('db:z', 'Z'));
    reg.replace(makeProvider('db:x', 'X2'));

    expect(reg.listIds().sort()).toEqual(['db:x', 'db:y', 'db:z']);
    expect(reg.getDefaultProvider().id).toBe('db:x');
  });
});
