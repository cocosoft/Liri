/**
 * 硬编码治理「同名常量」B2 守卫：协议/格式常量**唯一真源**（`CHANNEL_TAG` · `RESET`→`ANSI_RESET` · `BYTES_PER_TOKEN`）。
 *
 * 背景：这三组原为「同名常量在 ≥2 文件各写一份」——`lint:consts` 的 `同名常量:<NAME>` 检测项。
 * 2026-10-14 **续批 B2b**：再收 `A2A_TASKS_PATH`（原 `a2a-routes.ts` 与 `a2a/discoverySidecar.ts` 各一份）
 * 与 **oauth 加密参数 5 个 + 盐消歧**、**`WAV_HEADER_SIZE`**。
 * B2 的处置是**保留单一真源、其余处改为引用/转出**（导出面不变 ⇒ 零消费者改动、零行为变化）。
 *
 * 本测试即**防回流**：若有人再在消费侧写回 `const X =`，此处立即变红
 * （与棘轮门禁互补：门禁管"新增键 ⇒ 阻断"，本守卫管"这几处的形态不被改回"）。
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP = resolve(import.meta.dir, '../..');
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8');

describe('同名常量 B2 · 协议/格式常量唯一真源', () => {
  test('ANSI_RESET 真源存在、取值钉住、并声明为唯一真源', () => {
    const src = read('src/constants/figures.ts');
    expect(src).toMatch(/export const ANSI_RESET = '\\x1b\[0m';/);
    expect(src).toContain('唯一真源');
  });

  test('两个原副本（cli/print.ts · commands/tasks/tasks.ts）不再各自定义 RESET，改为引用真源', () => {
    for (const rel of ['src/cli/print.ts', 'src/commands/tasks/tasks.ts']) {
      const src = read(rel);
      expect(src).not.toMatch(/const RESET =/);
      expect(src).toContain("from '@modules/constants'");
      expect(src).toContain('ANSI_RESET');
    }
    // 消费点确实用了新名（防"只改 import 未改用法"）
    expect(read('src/cli/print.ts')).toContain('result += ANSI_RESET;');
    expect(read('src/commands/tasks/tasks.ts')).toContain('${ANSI_RESET}');
  });

  test('CHANNEL_TAG 真源在 constants/xml.ts；消费侧只保留导出面（不再定义）', () => {
    expect(read('src/constants/xml.ts')).toMatch(
      /export const CHANNEL_TAG = 'channel';/
    );
    const parser = read('src/chat/ChannelMessageParser.ts');
    expect(parser).not.toMatch(/const CHANNEL_TAG =/);
    expect(parser).toContain(
      "import { CHANNEL_TAG } from '@modules/constants';"
    );
    expect(parser).toContain('export { CHANNEL_TAG };');
  });

  test('BYTES_PER_TOKEN 真源在 constants/toolLimits.ts；消费侧只保留导出面（不再定义）', () => {
    expect(read('src/constants/toolLimits.ts')).toMatch(
      /export const BYTES_PER_TOKEN = 4;/
    );
    const types = read('src/services/toolResultStorage/types.ts');
    expect(types).not.toMatch(/const BYTES_PER_TOKEN =/);
    expect(types).toContain(
      "export { BYTES_PER_TOKEN } from '@modules/constants';"
    );
  });

  test('B2b：A2A_TASKS_PATH 真源在 types/a2a.ts（与 A2A_RPC_PATH 同处）；两消费侧不再各自定义', () => {
    const truth = read('src/types/a2a.ts');
    expect(truth).toMatch(/export const A2A_TASKS_PATH = '\/v1\/a2a\/tasks';/);
    expect(truth).toContain('单一事实源');
    // 两消费侧：均不再定义本地副本，且都从真源模块导入
    const routes = read(
      'src/infrastructure/http/handlers/routes/a2a-routes.ts'
    );
    const sidecar = read('src/infrastructure/http/a2a/discoverySidecar.ts');
    for (const src of [routes, sidecar]) {
      expect(src).not.toMatch(/const TASKS_PATH =/);
      expect(src).toContain('A2A_TASKS_PATH');
    }
    expect(routes).toContain(
      "import { A2A_RPC_PATH, A2A_TASKS_PATH } from '@modules/types/a2a';"
    );
    expect(sidecar).toContain(
      "import { A2A_TASKS_PATH } from '@modules/types/a2a';"
    );
  });

  test('B2b：AES-256-GCM 参数真源在 oauth/utils/OAuthCrypto.ts；两 store 以别名引用（加密实现逐字不动）', () => {
    const truth = read('src/oauth/utils/OAuthCrypto.ts');
    expect(truth).toMatch(
      /export const OAUTH_CIPHER_ALGORITHM = 'aes-256-gcm';/
    );
    expect(truth).toMatch(/export const OAUTH_CIPHER_IV_LENGTH = 16;/);
    expect(truth).toMatch(/export const OAUTH_CIPHER_AUTH_TAG_LENGTH = 16;/);
    expect(truth).toMatch(/export const OAUTH_CIPHER_KEY_LENGTH = 32;/);
    expect(truth).toMatch(/export const OAUTH_PBKDF2_ITERATIONS = 100000;/);
    for (const rel of [
      'src/oauth/OAuthProviderStore.ts',
      'src/oauth/services/OAuthStorage.ts',
    ]) {
      const src = read(rel);
      // 不再各自定义参数常量...
      for (const decl of [
        /const ALGORITHM =/,
        /const IV_LENGTH =/,
        /const AUTH_TAG_LENGTH =/,
        /const KEY_LENGTH =/,
        /const ITERATIONS =/,
        /const PBKDF2_SALT =/,
      ]) {
        expect(src).not.toMatch(decl);
      }
      // ...而是以**别名导入**保留原有局部名（实现零改动）
      expect(src).toContain('OAUTH_CIPHER_ALGORITHM as ALGORITHM');
      expect(src).toContain('OAUTH_PBKDF2_ITERATIONS as ITERATIONS');
    }
    // 盐已**改名消歧**但**值不变**（两处本就不同值 ⇒ 存量密文照常解密）
    expect(read('src/oauth/OAuthProviderStore.ts')).toContain(
      "'pyapp-oauth-provider-salt-v1'"
    );
    expect(read('src/oauth/services/OAuthStorage.ts')).toContain(
      "'pyapp-oauth-salt-v2'"
    );
  });

  test('B2b：WAV_HEADER_SIZE 真源在 services/voice/services/audioUtils.ts；三处消费侧改引真源', () => {
    expect(read('src/services/voice/services/audioUtils.ts')).toMatch(
      /export const WAV_HEADER_SIZE = 44;/
    );
    for (const rel of [
      'src/services/voice/services/audioPlayer.ts',
      'src/services/voice/services/playbackManager.ts',
      'src/services/voice/services/ttsProvider.ts',
    ]) {
      const src = read(rel);
      expect(src).not.toMatch(/const WAV_HEADER_SIZE =/);
      expect(src).toContain("import { WAV_HEADER_SIZE } from './audioUtils';");
    }
  });

  test('B3-1：通道标识已按适配器消歧（不再同名）；`DEFAULT_OLLAMA_URL` 本地别名已删（直用真源）', () => {
    const adapters: Array<[string, string]> = [
      ['src/agent/orchestration/SwarmChannelAdapter.ts', 'SWARM_CHANNEL'],
      [
        'src/agent/orchestration/SchedulerChannelAdapter.ts',
        'SCHEDULER_CHANNEL',
      ],
      ['src/agent/orchestration/RemoteChannelAdapter.ts', 'REMOTE_CHANNEL'],
    ];
    for (const [rel, name] of adapters) {
      const src = read(rel);
      expect(src).not.toMatch(/const CHANNEL =/);
      // 不含 `=` 后尾空格：prettier 可能因新名变长而把声明换行
      expect(src).toContain(`const ${name} =`);
      expect(src).toContain(`[${name}]`);
    }
    for (const rel of [
      'src/ai/local/ollama/registerOllamaProvider.ts',
      'src/ai/embedding/providers/LocalEmbeddingProvider.ts',
    ]) {
      const src = read(rel);
      // 不再有**定义**（注释里可提及历史名）
      expect(src).not.toMatch(/const DEFAULT_OLLAMA_URL/);
      expect(src).toContain('DEFAULT_OLLAMA_ENDPOINT');
    }
  });

  test('B3-2：`MAX_STATUS_CHARS` 真源在 GitDetector.ts（3→1）；`LLAMACPP_PROVIDER_TYPE` 真源在 LlamaCppServerManager.ts（2→1）', () => {
    const git = read('src/context/GitDetector.ts');
    expect(git).toMatch(/export const MAX_STATUS_CHARS = 2000;/);
    expect(git).toContain('唯一真源');
    const consumers: Array<[string, string]> = [
      ['src/context/GitContextService.ts', "from './GitDetector'"],
      ['src/context/services/SystemContextService.ts', "from '../GitDetector'"],
    ];
    for (const [rel, imp] of consumers) {
      const src = read(rel);
      expect(src).not.toMatch(/const MAX_STATUS_CHARS =/);
      expect(src).toContain(imp);
    }
    const mgr = read('src/ai/local/llama/LlamaCppServerManager.ts');
    expect(mgr).toMatch(
      /export const LLAMACPP_PROVIDER_TYPE = 'llamacpp' as const;/
    );
    const reg = read('src/ai/local/llama/registerLlamaCppProvider.ts');
    expect(reg).not.toMatch(/const LLAMACPP_PROVIDER_TYPE =/);
    expect(reg).toContain('LLAMACPP_PROVIDER_TYPE,');
  });

  test('B3-3：`MODEL_ALIASES` 唯一真源在 ai/models/ModelAliases.ts（AIModelManager 改导入，不保留副本）', () => {
    expect(read('src/ai/models/ModelAliases.ts')).toMatch(
      /export const MODEL_ALIASES = \['best', 'fast', 'pro', 'flash'\] as const;/
    );
    const mgr = read('src/ai/AIModelManager.ts');
    expect(mgr).not.toMatch(/export const MODEL_ALIASES =/);
    expect(mgr).toContain(
      "import { MODEL_ALIASES, type ModelAlias } from './models/ModelAliases';"
    );
  });

  test('B3-4：`CRED_STORED_MARKER` 真源上提到 infra `constants/common.ts`（chronos 侧复刻已删；app 侧保留导出面）', () => {
    expect(read('src/constants/common.ts')).toMatch(
      /export const CRED_STORED_MARKER = '__stored__';/
    );
    expect(
      read('src/chronos/maintenance/ChronosBackgroundHousekeeping.ts')
    ).not.toMatch(/const CRED_STORED_MARKER =/);
    const cs = read('src/ai/credentials/CredentialStore.ts');
    expect(cs).not.toMatch(/const CRED_STORED_MARKER =/);
    expect(cs).toContain(
      "export { CRED_STORED_MARKER } from '@modules/constants';"
    );
  });

  test('B5-1①：`TABLE_NAME` ×5 已按域消歧（不再同名；表名字符串值未改）', () => {
    const stores: Array<[string, string, string]> = [
      ['src/workspace/TaskStore.ts', 'TASKS_TABLE_NAME', "'tasks'"],
      [
        'src/workspace/ProjectItemStore.ts',
        'PROJECT_ITEMS_TABLE_NAME',
        "'project_items'",
      ],
      [
        'src/query/DBTAORCheckpointStorage.ts',
        'TAOR_CHECKPOINTS_TABLE_NAME',
        "'taor_checkpoints'",
      ],
      [
        'src/ai/translation/TranslateHistoryStore.ts',
        'TRANSLATE_HISTORY_TABLE_NAME',
        "'translate_history'",
      ],
      [
        'src/ai/router/SessionRouterStore.ts',
        'SESSION_ROUTER_TABLE_NAME',
        "'router_session_routes'",
      ],
    ];
    for (const [rel, name, value] of stores) {
      const src = read(rel);
      expect(src).not.toMatch(/const TABLE_NAME =/);
      expect(src).toContain(`const ${name} = ${value};`);
    }
  });

  test('B5-1②：`DEFAULT_BASE_URL` ×5 已按域消歧（Ollama 去别名；其余按 provider 改名）', () => {
    const pairs: Array<[string, string]> = [
      ['src/ai/providers/OpenAIProvider.ts', 'OPENAI_PROVIDER_BASE_URL'],
      [
        'src/ai/embedding/providers/OpenAIEmbeddingProvider.ts',
        'OPENAI_EMBEDDING_BASE_URL',
      ],
      ['src/ai/providers/LlamaCppProvider.ts', 'LLAMACPP_PROVIDER_BASE_URL'],
      ['src/ai/providers/GoogleProvider.ts', 'GOOGLE_PROVIDER_BASE_URL'],
    ];
    for (const [rel, name] of pairs) {
      const src = read(rel);
      expect(src).not.toMatch(/const DEFAULT_BASE_URL =/);
      // 不含 `=` 后尾空格：prettier 可能因新名变长而把声明换行
      expect(src).toContain(`const ${name} =`);
    }
    const ollama = read('src/ai/providers/OllamaProvider.ts');
    expect(ollama).not.toContain('DEFAULT_BASE_URL');
    expect(ollama).toContain('DEFAULT_OLLAMA_ENDPOINT');
  });
});
