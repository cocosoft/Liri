/**
 * BlueBubbles 通道基础契约（2026-10-31，支持等级台账：community → core）
 */
import {
  getDefaultBlueBubblesConfig,
  validateBlueBubblesConfig,
} from '../../src/channels/bluebubbles/config-schema';
import {
  getBlueBubblesAccount,
  listBlueBubblesAccountIds,
  registerBlueBubblesAccount,
  removeBlueBubblesAccount,
} from '../../src/channels/bluebubbles/accounts';
import { describeChannelBasics } from './support/channelBasics';

describeChannelBasics({
  id: 'bluebubbles',
  requiredKeys: ['serverUrl', 'password'],
  defaults: () => getDefaultBlueBubblesConfig(),
  validate: validateBlueBubblesConfig,
  validConfig: { serverUrl: 'http://127.0.0.1:1234', password: 'pwd' },
  accounts: {
    register: (id) =>
      registerBlueBubblesAccount(id, {
        serverUrl: 'http://127.0.0.1:1234',
        password: 'pwd',
      }),
    get: (id) => getBlueBubblesAccount(id),
    list: () => listBlueBubblesAccountIds(),
    remove: (id) => removeBlueBubblesAccount(id),
  },
});
