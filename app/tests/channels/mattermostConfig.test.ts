/**
 * Mattermost 通道基础契约（2026-10-31，支持等级台账：community → core）
 */
import {
  getDefaultMattermostConfig,
  validateMattermostConfig,
} from '../../src/channels/mattermost/config-schema';
import {
  getMattermostAccount,
  listMattermostAccountIds,
  registerMattermostAccount,
  removeMattermostAccount,
} from '../../src/channels/mattermost/accounts';
import { describeChannelBasics } from './support/channelBasics';

describeChannelBasics({
  id: 'mattermost',
  requiredKeys: ['serverUrl', 'botToken'],
  defaults: () => getDefaultMattermostConfig(),
  validate: validateMattermostConfig,
  validConfig: { serverUrl: 'https://mm.example.com', botToken: 'token' },
  accounts: {
    register: (id) =>
      registerMattermostAccount(id, {
        serverUrl: 'https://mm.example.com',
        botToken: 'token',
      }),
    get: (id) => getMattermostAccount(id),
    list: () => listMattermostAccountIds(),
    remove: (id) => removeMattermostAccount(id),
  },
});
