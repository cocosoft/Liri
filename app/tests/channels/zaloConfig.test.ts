/**
 * Zalo 通道基础契约（2026-10-31，支持等级台账：community → core）
 */
import {
  getDefaultZaloConfig,
  validateZaloConfig,
} from '../../src/channels/zalo/config-schema';
import {
  getZaloAccount,
  listZaloAccountIds,
  registerZaloAccount,
  removeZaloAccount,
} from '../../src/channels/zalo/accounts';
import { describeChannelBasics } from './support/channelBasics';

describeChannelBasics({
  id: 'zalo',
  requiredKeys: ['appId', 'appSecret', 'accessToken'],
  defaults: () => getDefaultZaloConfig(),
  validate: validateZaloConfig,
  validConfig: { appId: 'app-1', appSecret: 'secret', accessToken: 'token' },
  accounts: {
    register: (id) =>
      registerZaloAccount(id, {
        appId: 'app-1',
        secretKey: 'secret',
        accessToken: 'token',
      }),
    get: (id) => getZaloAccount(id),
    list: () => listZaloAccountIds(),
    remove: (id) => removeZaloAccount(id),
  },
});
