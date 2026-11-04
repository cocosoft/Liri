// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-1（2026-11-04，《运行态问题排查与修复方案》）：**下一梯队**日志降噪。
 *
 * 真机窗口（`since=2026-11-04T04:00Z`，189 011 行）里这几处全部是"每次请求/每次工具都打"
 * 的稳态 info：
 * - `BaseAIProvider · 已注入 Bun 原生 tls.ca 证书` 4 494 条（值恒定）
 * - `schema:sanitized` 4 496 条（每次清洗命中规则即打）
 * - `reactToolLoop:_buildToolRoundMessages` 3 759 条（正常路径也打）
 *
 * 本文件钉住：配置类事实**每进程一次**、实现细节走 debug、诊断日志**只在可疑时**回 INFO。
 */
import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { getLogger } from '@openliri/infra/monitoring/logs/Logger';
import { sanitizeSchema } from '../../src/tools/SchemaSanitizer';
import { BaseAIProvider } from '../../src/ai/providers/BaseAIProvider';
import { shouldLogToolRoundAtInfo } from '../../src/chat/pipeline/streamMessageLifecycle';

interface BaseProviderSeams {
  _caCertFilePath: string | null | undefined;
  _tlsCaLogged: boolean;
  injectCADispatcher(init?: RequestInit): RequestInit;
}

const providerSeam = BaseAIProvider as unknown as BaseProviderSeams;

describe('P2-1：tls.ca 注入提示每进程一次', () => {
  const origPath = providerSeam._caCertFilePath;
  const origLogged = providerSeam._tlsCaLogged;
  let infoSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    infoSpy?.mockRestore();
    providerSeam._caCertFilePath = origPath;
    providerSeam._tlsCaLogged = origLogged;
  });

  it('连续两次注入 ⇒ 只打 1 条（不再按请求刷屏）', () => {
    // 借一个必然存在的文件当"证书路径"，绕开平台差异（本用例只验去重，不验证书内容）
    providerSeam._caCertFilePath = process.execPath;
    providerSeam._tlsCaLogged = false;
    infoSpy = spyOn(getLogger('ai:baseProvider'), 'info');

    providerSeam.injectCADispatcher();
    providerSeam.injectCADispatcher();

    const hits = (infoSpy.mock.calls as unknown[][]).filter(
      (c) => c[0] === 'BaseAIProvider · 已注入 Bun 原生 tls.ca 证书'
    );
    expect(hits.length).toBe(1);
  });
});

describe('P2-1：schema:sanitized 走 debug', () => {
  let infoSpy: ReturnType<typeof spyOn>;
  let debugSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    infoSpy?.mockRestore();
    debugSpy?.mockRestore();
  });

  it('命中清洗规则 ⇒ 只进 debug，INFO 不再出现该单点', () => {
    const logger = getLogger('tools:schemaSanitizer');
    infoSpy = spyOn(logger, 'info');
    debugSpy = spyOn(logger, 'debug');

    const r = sanitizeSchema(
      {
        type: 'object',
        patternProperties: { '^x-': { type: 'string' } },
      },
      { provider: 'ollama' }
    );

    expect(r.modified).toBe(true);
    const infos = (infoSpy.mock.calls as unknown[][]).filter(
      (c) => c[0] === 'schema:sanitized'
    );
    const debugs = (debugSpy.mock.calls as unknown[][]).filter(
      (c) => c[0] === 'schema:sanitized'
    );
    expect(infos.length).toBe(0);
    expect(debugs.length).toBe(1);
  });
});

describe('P2-1：_buildToolRoundMessages 只在可疑时回 INFO', () => {
  it('结果条数与工具调用一致（正常）⇒ 不进 INFO', () => {
    expect(shouldLogToolRoundAtInfo(2, 2)).toBe(false);
    expect(shouldLogToolRoundAtInfo(0, 0)).toBe(false);
  });

  it('条数不一致（结果没拼进去）⇒ 仍 INFO', () => {
    expect(shouldLogToolRoundAtInfo(1, 2)).toBe(true);
    expect(shouldLogToolRoundAtInfo(2, 1)).toBe(true);
  });
});
