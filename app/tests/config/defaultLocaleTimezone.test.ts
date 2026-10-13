/**
 * Q-H2（2026-10-13 裁定 · 硬编码统一治理方案 `§11 Q-H2`）：**默认语言 / 时区口径归一**
 *
 * 背景（取证）：`constants/common.ts` 原为 `DEFAULT_LOCALE='en-US'` / `DEFAULT_TIMEZONE='UTC'`，
 * 与仓内实际默认（i18n `LanguageManager`、语音 TTS/唤醒词、插件设置均为 `'zh-CN'`；前端 i18n
 * `fallbackLng:"zh"`）**口径相反**，且这两个常量当时**零消费者**（grep 仅命中定义处）⇒ 属"假真源"。
 *
 * 本轮口径：**统一为 `zh-CN` / `Asia/Shanghai`**，并把散落字面量**改为引用真源**。
 *
 * 覆盖：
 * ① 真源取值（值断言）；
 * ② **决策点已引用真源**（源码守卫，精确到"该行"而非"全文件无字面量"—— 因为语言清单等处
 *    合法地仍会列出 `'zh-CN'`/`'en-US'`）；
 * ③ **跨部署单元同值契约**（前端无法 import 后端常量）⇒ 断言前端时区兜底同为 `Asia/Shanghai`；
 * ④ **cron 的"跟随系统时区"语义保留**（不得被误改为硬编码城市时区）。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from '../../src/constants/common';

const APP_SRC = join(import.meta.dir, '..', '..', 'src');
const CLIENT_SRC = join(import.meta.dir, '..', '..', '..', 'client', 'src');

/** 去注释后再匹配（注释里会引用旧写法，避免误判） */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function read(rel: string, base = APP_SRC): string {
  return stripComments(readFileSync(join(base, rel), 'utf-8'));
}

describe('Q-H2：默认语言 / 时区口径归一（zh-CN / Asia/Shanghai）', () => {
  it('① 真源取值：DEFAULT_LOCALE=zh-CN、DEFAULT_TIMEZONE=Asia/Shanghai', () => {
    expect(DEFAULT_LOCALE).toBe('zh-CN');
    expect(DEFAULT_TIMEZONE).toBe('Asia/Shanghai');
  });

  it('② 决策点引用真源（不再写死字面量）', () => {
    const sites: Array<{ rel: string; decision: RegExp }> = [
      {
        rel: 'docs/i18n/LanguageManager.ts',
        decision: /private currentLanguage: string = DEFAULT_LOCALE/,
      },
      {
        rel: 'services/voice/services/ttsConfigOverlay.ts',
        decision: /defaultLanguage: DEFAULT_LOCALE/,
      },
      {
        rel: 'services/voice/services/voiceService.ts',
        decision: /language: config\.language \|\| DEFAULT_LOCALE/,
      },
      {
        rel: 'services/voice/VoiceProvider.ts',
        decision: /language: DEFAULT_LOCALE/,
      },
      {
        rel: 'voice/WakeWordEngine.ts',
        decision: /this\.language = config\.language \?\? DEFAULT_LOCALE/,
      },
      {
        rel: 'hooks/useVoice.ts',
        decision: /language: DEFAULT_LOCALE/,
      },
      {
        rel: 'plugins/bundled/SettingsPlugin.ts',
        decision: /language: DEFAULT_LOCALE/,
      },
    ];
    for (const { rel, decision } of sites) {
      const code = read(rel);
      // 必须：该决策点取真源
      expect(code, `${rel} 的默认语言决策点未引用 DEFAULT_LOCALE`).toMatch(
        decision
      );
      // 必须：确实从 `@modules/constants` 引入（而非本文件另造常量）
      expect(code, `${rel} 未 import DEFAULT_LOCALE`).toMatch(
        /import\s*\{[^}]*DEFAULT_LOCALE[^}]*\}\s*from\s*'@modules\/constants'/
      );
    }
    // VoiceProvider 原默认是 'en-US'（与口径相反）⇒ 该默认值不应再出现
    expect(read('services/voice/VoiceProvider.ts')).not.toMatch(
      /language: 'en-US'/
    );
  });

  it('③ 跨部署单元同值契约：前端时区兜底 = 后端 DEFAULT_TIMEZONE', () => {
    // 前端为独立部署单元，物理上无法 import 后端常量 ⇒ 用"同值断言"钉住口径
    for (const rel of [
      'components/common/Footer.tsx',
      'components/views/DashboardPage.tsx',
    ]) {
      const code = read(rel, CLIENT_SRC);
      expect(code, `${rel} 的时区兜底与后端口径不一致`).toContain(
        DEFAULT_TIMEZONE
      );
    }
  });

  it('④ cron 保持"跟随系统时区"（不得误改为硬编码城市时区）', () => {
    const code = read('utils/cron.ts');
    expect(code).toMatch(
      /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/
    );
    expect(code).not.toMatch(/resolveTimezone[\s\S]{0,120}'Asia\/Shanghai'/);
  });
});
