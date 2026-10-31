/**
 * Facebook Messenger 通道基础契约（2026-10-31，支持等级台账：community → core）
 */
import { describe, expect, it } from 'bun:test';

import {
  getDefaultFacebookMessengerConfig,
  validateFacebookMessengerConfig,
} from '../../src/channels/facebookmessenger/config-schema';
import {
  getFacebookMessengerAccount,
  listFacebookMessengerAccountIds,
  registerFacebookMessengerAccount,
  removeFacebookMessengerAccount,
} from '../../src/channels/facebookmessenger/accounts';
import { describeChannelBasics } from './support/channelBasics';

describeChannelBasics({
  id: 'facebook',
  requiredKeys: ['pageAccessToken', 'verifyToken'],
  defaults: () => getDefaultFacebookMessengerConfig(),
  validate: validateFacebookMessengerConfig,
  validConfig: {
    pageAccessToken: 'token',
    verifyToken: 'verify',
    appSecret: 'secret',
    pageId: '123',
  },
  accounts: {
    register: (id) =>
      registerFacebookMessengerAccount(id, {
        pageAccessToken: 'token',
        verifyToken: 'verify',
        appSecret: 'secret',
        pageId: '123',
      }),
    get: (id) => getFacebookMessengerAccount(id),
    list: () => listFacebookMessengerAccountIds(),
    remove: (id) => removeFacebookMessengerAccount(id),
  },
});

describe('facebook 条件校验', () => {
  it('appSecret / pageId 非必填，但给了就必须是字符串', () => {
    expect(
      validateFacebookMessengerConfig({
        pageAccessToken: 't',
        verifyToken: 'v',
      })
    ).toHaveLength(0);
    const errors = validateFacebookMessengerConfig({
      pageAccessToken: 't',
      verifyToken: 'v',
      appSecret: 1,
      pageId: 2,
    });
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toContain('appSecret');
    expect(errors.join('\n')).toContain('pageId');
  });
});
