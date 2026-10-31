/**
 * Twitter（X）通道基础契约（2026-10-31，支持等级台账：community → core）
 *
 * 注意：配置字段名为 `apiSecretKey` / `accessTokenSecret`，账户字段为 `apiSecret` / `accessSecret`。
 */
import {
  getDefaultTwitterConfig,
  validateTwitterConfig,
} from '../../src/channels/twitter/config-schema';
import {
  getTwitterAccount,
  listTwitterAccountIds,
  registerTwitterAccount,
  removeTwitterAccount,
} from '../../src/channels/twitter/accounts';
import { describeChannelBasics } from './support/channelBasics';

describeChannelBasics({
  id: 'twitter',
  requiredKeys: ['apiKey', 'apiSecretKey', 'accessToken', 'accessTokenSecret'],
  defaults: () => getDefaultTwitterConfig(),
  validate: validateTwitterConfig,
  validConfig: {
    apiKey: 'k',
    apiSecretKey: 's',
    accessToken: 't',
    accessTokenSecret: 'x',
  },
  accounts: {
    register: (id) =>
      registerTwitterAccount(id, {
        apiKey: 'k',
        apiSecret: 's',
        accessToken: 't',
        accessSecret: 'x',
      }),
    get: (id) => getTwitterAccount(id),
    list: () => listTwitterAccountIds(),
    remove: (id) => removeTwitterAccount(id),
  },
});
