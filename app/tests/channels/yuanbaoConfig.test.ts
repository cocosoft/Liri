/**
 * 元宝（Yuanbao）通道基础契约（2026-10-31，支持等级台账：community → core）
 */
import { describe, expect, it } from 'bun:test';

import {
  getDefaultYuanbaoConfig,
  validateYuanbaoConfig,
} from '../../src/channels/yuanbao/config-schema';
import {
  getYuanbaoAccount,
  listYuanbaoAccountIds,
  registerYuanbaoAccount,
  removeYuanbaoAccount,
} from '../../src/channels/yuanbao/accounts';
import { describeChannelBasics } from './support/channelBasics';

describeChannelBasics({
  id: 'yuanbao',
  requiredKeys: ['appKey'],
  defaults: () => getDefaultYuanbaoConfig(),
  validate: validateYuanbaoConfig,
  validConfig: { appKey: 'key-1', apiBaseUrl: 'https://api.example.com' },
  accounts: {
    register: (id) =>
      registerYuanbaoAccount(id, {
        apiKey: 'key-1',
        apiUrl: 'https://api.example.com',
      }),
    get: (id) => getYuanbaoAccount(id),
    list: () => listYuanbaoAccountIds(),
    remove: (id) => removeYuanbaoAccount(id),
  },
});

describe('yuanbao 条件校验', () => {
  it('apiBaseUrl 非必填，但给了就必须是字符串', () => {
    expect(validateYuanbaoConfig({ appKey: 'k' })).toHaveLength(0);
    const errors = validateYuanbaoConfig({ appKey: 'k', apiBaseUrl: 123 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('apiBaseUrl');
  });
});
