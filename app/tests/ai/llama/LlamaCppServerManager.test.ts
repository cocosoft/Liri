/**
 * LlamaCppServerManager 单元测试（Phase 1）
 *
 * 覆盖：
 *  - verifySha256 纯函数（未登记跳过 / 匹配通过 / 不匹配抛错）
 *  - ensureBinary 下载 + SHA256 + adm-zip 解压（mock fetch 返回真实 zip）
 *  - start() spawn 参数组装（mock child_process.spawn）
 *  - 端口接管（health 可达时不重复拉起）
 *  - 崩溃退避重启（exit → restartCount 增加；stop 后不重启）
 *
 * 路径隔离：通过 LIRI_DATA_DIR 指向临时目录，不污染真实数据目录。
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'events';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import AdmZip from 'adm-zip';
import {
  LlamaCppServerManager,
  LLAMA_VERSION,
  verifySha256,
  EXPECTED_SHA256,
  resolveDownloadVariant,
  buildArgs,
  type LlamaServerConfig,
} from '../../../src/ai/local/llama/LlamaCppServerManager.js';
import {
  resolveLlamaBinaryPath,
  resolveLlamaDir,
} from '../../../src/core/paths.js';

// ── mock child_process.spawn ────────────────────────────────

type FakeProc = {
  kill: () => void;
  on: (evt: string, cb: (...args: unknown[]) => void) => FakeProc;
  _emit: (evt: string, ...args: unknown[]) => void;
};

const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
const procs: FakeProc[] = [];

mock.module('child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args });
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const proc = {
      kill: () => {
        // no-op
      },
      on: (evt: string, cb: (...args: unknown[]) => void) => {
        handlers[evt] = cb;
        return proc;
      },
      _emit: (evt: string, ...args: unknown[]) => {
        handlers[evt]?.(...args);
      },
    } as FakeProc;
    procs.push(proc);
    return proc;
  },
}));

// ── fetch mock 工具 ─────────────────────────────────────────

/** 生成包含 llama-server 可执行文件的真实 zip buffer */
function makeZip(): Buffer {
  const zip = new AdmZip();
  const variant = resolveDownloadVariant();
  zip.addFile(
    `llama-${LLAMA_VERSION}-bin-${variant}/llama-server.exe`,
    Buffer.from('fake-llama-server-binary'),
  );
  return zip.toBuffer();
}

/** 构造 health 探测的 Response 形状 */
function healthRes(ok: boolean): { ok: boolean; status: number } {
  return { ok, status: ok ? 200 : 503 };
}

// ── 路径隔离 ────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'llama-test-'));
  process.env.LIRI_DATA_DIR = tmpDir;
  delete process.env.LLAMA_CPP_PORT;
  delete process.env.LLAMA_CPP_MODEL;
  spawnCalls.length = 0;
  procs.length = 0;
  LlamaCppServerManager.resetInstance();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.LIRI_DATA_DIR;
});

/**
 * 临时禁用当前版本的登记值（fake zip 与真实 SHA256 必然不符），用后恢复。
 * 所有走 ensureBinary 下载路径的用例都必须包一层，避免强校验拦截 fake 数据。
 */
function disableSha256(): () => void {
  const saved = EXPECTED_SHA256[LLAMA_VERSION];
  delete EXPECTED_SHA256[LLAMA_VERSION];
  return () => {
    if (saved) EXPECTED_SHA256[LLAMA_VERSION] = saved;
  };
}

// ── 用例 ───────────────────────────────────────────────────

describe('verifySha256', () => {
  it('当前锁定版本已登记期望值（强校验启用）', () => {
    const expected = EXPECTED_SHA256[LLAMA_VERSION];
    expect(expected).toBeDefined();
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it('未登记期望值时跳过强校验并返回实际值', () => {
    const data = Buffer.from('hello');
    const actual = verifySha256(data, undefined, 'b-test');
    expect(actual).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('期望值匹配时通过', () => {
    const data = Buffer.from('hello');
    const expected =
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    expect(() => verifySha256(data, expected, 'b-test')).not.toThrow();
  });

  it('期望值不匹配时抛错', () => {
    const data = Buffer.from('hello');
    expect(() =>
      verifySha256(data, '0'.repeat(64), 'b-test'),
    ).toThrow(/SHA256 校验失败/);
  });
});

describe('ensureBinary（下载 + 解压）', () => {
  it('带顶层目录的 zip：下载并解压，二进制提升到 llama 目录根', async () => {
    const restore = disableSha256();
    try {
      const zipBuf = makeZip();
      const fetchMock = mock((url: string | URL) => {
        return Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: async () => zipBuf,
        });
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const mgr = new LlamaCppServerManager();
      await mgr.ensureBinary();

      expect(existsSync(resolveLlamaBinaryPath())).toBe(true);
      const urlStr = String(fetchMock.mock.calls[0]?.[0]);
      expect(urlStr).toContain('releases/download');
    } finally {
      restore();
    }
  });

  it('扁平结构 zip（真实官方格式）：全量解压到 llama 目录根', async () => {
    const restore = disableSha256();
    try {
      const zip = new AdmZip();
      zip.addFile('llama-server.exe', Buffer.from('fake-exe'));
      zip.addFile('llama-server-impl.dll', Buffer.from('fake-impl-dll'));
      zip.addFile('ggml.dll', Buffer.from('fake-ggml'));
      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: async () => zip.toBuffer(),
        }),
      ) as typeof fetch;

      const mgr = new LlamaCppServerManager();
      await mgr.ensureBinary();

      expect(existsSync(resolveLlamaBinaryPath())).toBe(true);
      // 配套 DLL 一并解压（llama-server 运行必需）
      expect(existsSync(join(resolveLlamaDir(), 'llama-server-impl.dll'))).toBe(
        true,
      );
      expect(existsSync(join(resolveLlamaDir(), 'ggml.dll'))).toBe(true);
    } finally {
      restore();
    }
  });

  it('下载返回非 2xx 时抛错', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 404 }),
    ) as typeof fetch;

    const mgr = new LlamaCppServerManager();
    await expect(mgr.ensureBinary()).rejects.toThrow(/下载失败 HTTP 404/);
  });
});

describe('buildArgs（D4 参数组装纯函数）', () => {
  const base: LlamaServerConfig = {
    host: '127.0.0.1',
    port: 11435,
    model: '/models/x.gguf',
    autoStart: true,
    gpuLayers: 8,
    contextWindow: 8192,
    kvCache: 'medium',
    threads: 4,
    batchSize: 512,
    temperature: 0.7,
    topK: 30,
    topP: 0.9,
    repeatPenalty: 1.05,
    seed: 42,
    noMmap: true,
    mlock: true,
    flashAttn: 'on',
  };

  it('全量参数完整组装（含 KV cache 档位映射与高级开关）', () => {
    const args = buildArgs(base);
    expect(args).toContain('--host');
    expect(args[args.indexOf('--host') + 1]).toBe('127.0.0.1');
    expect(args).toContain('--port');
    expect(args[args.indexOf('--port') + 1]).toBe('11435');
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('/models/x.gguf');
    expect(args).toContain('--n-gpu-layers');
    expect(args[args.indexOf('--n-gpu-layers') + 1]).toBe('8');
    expect(args).toContain('--ctx-size');
    expect(args[args.indexOf('--ctx-size') + 1]).toBe('8192');
    // D1: KV cache 档位 → --cache-type-k/v
    expect(args[args.indexOf('--cache-type-k') + 1]).toBe('q8_0');
    expect(args[args.indexOf('--cache-type-v') + 1]).toBe('q8_0');
    // 线程/批大小显式传入
    expect(args[args.indexOf('--threads') + 1]).toBe('4');
    expect(args[args.indexOf('--batch-size') + 1]).toBe('512');
    // D2: 采样显式传默认值
    expect(args[args.indexOf('--temp') + 1]).toBe('0.7');
    expect(args[args.indexOf('--top-k') + 1]).toBe('30');
    expect(args[args.indexOf('--top-p') + 1]).toBe('0.9');
    expect(args[args.indexOf('--repeat-penalty') + 1]).toBe('1.05');
    expect(args[args.indexOf('--seed') + 1]).toBe('42');
    // 高级开关开启时传入
    expect(args).toContain('--no-mmap');
    expect(args).toContain('--mlock');
    expect(args[args.indexOf('--flash-attn') + 1]).toBe('on');
  });

  it('条件传参：threads/batchSize=0 与未开启高级开关时不拼参数', () => {
    const args = buildArgs({ ...base, threads: 0, batchSize: 0, noMmap: false, mlock: false, flashAttn: 'auto' });
    expect(args).not.toContain('--threads');
    expect(args).not.toContain('--batch-size');
    expect(args).not.toContain('--no-mmap');
    expect(args).not.toContain('--mlock');
    expect(args[args.indexOf('--flash-attn') + 1]).toBe('auto');
  });

  it('KV cache 档位映射：low=q4_0 / medium=q8_0 / high=f16', () => {
    expect(buildArgs({ ...base, kvCache: 'low' })[buildArgs({ ...base, kvCache: 'low' }).indexOf('--cache-type-k') + 1]).toBe('q4_0');
    expect(buildArgs({ ...base, kvCache: 'high' })[buildArgs({ ...base, kvCache: 'high' }).indexOf('--cache-type-v') + 1]).toBe('f16');
  });
});

describe('validateConfig（扩展字段校验）', () => {
  it('非法 kvCache / temperature / topK / topP / flashAttn 时拒绝', () => {
    const mgr = new LlamaCppServerManager(() => ({}));
    expect(
      mgr.validateConfig({ kvCache: 'ultra' as never }).valid,
    ).toBe(false);
    expect(mgr.validateConfig({ temperature: 3 }).valid).toBe(false);
    expect(mgr.validateConfig({ topK: 0 }).valid).toBe(false);
    expect(mgr.validateConfig({ topP: 1.5 }).valid).toBe(false);
    expect(
      mgr.validateConfig({ flashAttn: 'maybe' as never }).valid,
    ).toBe(false);
  });

  it('合法扩展值通过', () => {
    const mgr = new LlamaCppServerManager(() => ({}));
    const r = mgr.validateConfig({
      kvCache: 'low',
      threads: 4,
      batchSize: 512,
      temperature: 1,
      topK: 40,
      topP: 0.95,
      repeatPenalty: 1.1,
      flashAttn: 'auto',
    });
    expect(r.valid).toBe(true);
  });
});

describe('start（拉起子进程）', () => {
  it('组装 --port/--model/--n-gpu-layers/--ctx-size 参数', async () => {
    const restore = disableSha256();
    // 下载二进制
    const zipBuf = makeZip();
    let healthCalls = 0;
    const fetchMock = mock((url: string | URL) => {
      const u = String(url);
      if (u.includes('/health')) {
        healthCalls += 1;
        // 第 1 次（spawn 前探测）不可达；spawn 后探测返回就绪
        return Promise.resolve(healthRes(healthCalls > 1));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => zipBuf,
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const mgr = new LlamaCppServerManager(() => ({
      port: 11436,
      model: '/tmp/models/llama3.1-8b.gguf',
      gpuLayers: 8,
      contextWindow: 8192,
    }));
    await mgr.start();

    expect(spawnCalls).toHaveLength(1);
    const { cmd, args } = spawnCalls[0];
    expect(cmd).toContain('llama-server');
    expect(args).toContain('--port');
    expect(args[args.indexOf('--port') + 1]).toBe('11436');
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('/tmp/models/llama3.1-8b.gguf');
    expect(args).toContain('--n-gpu-layers');
    expect(args[args.indexOf('--n-gpu-layers') + 1]).toBe('8');
    expect(args).toContain('--ctx-size');
    expect(args[args.indexOf('--ctx-size') + 1]).toBe('8192');

    // 清理：stop 避免悬挂
    await mgr.stop();
    restore();
  });

  it('端口已有 llama-server 时直接接管，不重复拉起', async () => {
    const restore = disableSha256();
    const zipBuf = makeZip();
    globalThis.fetch = mock((url: string | URL) => {
      if (String(url).includes('/health')) {
        return Promise.resolve(healthRes(true)); // 一直可达
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => zipBuf,
      });
    }) as typeof fetch;

    const mgr = new LlamaCppServerManager(() => ({
      model: '/tmp/models/x.gguf',
    }));
    await mgr.start();

    expect(spawnCalls).toHaveLength(0); // 接管而非拉起
    const status = await mgr.getStatus();
    expect(status.running).toBe(true);
    restore();
  });
});

describe('崩溃退避重启', () => {
  it('子进程非主动退出时记录 restartCount 并计划重启', async () => {
    const restore = disableSha256();
    const zipBuf = makeZip();
    let healthCalls = 0;
    globalThis.fetch = mock((url: string | URL) => {
      if (String(url).includes('/health')) {
        healthCalls += 1;
        return Promise.resolve(healthRes(healthCalls > 1));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => zipBuf,
      });
    }) as typeof fetch;

    const mgr = new LlamaCppServerManager(() => ({
      model: '/tmp/models/x.gguf',
    }));
    await mgr.start();
    expect(spawnCalls).toHaveLength(1);

    // 模拟崩溃退出
    procs[0]._emit('exit', 1, null);
    await new Promise((r) => setTimeout(r, 10));

    const status = await mgr.getStatus();
    expect(status.restartCount).toBe(1);
    expect(status.lastError).toContain('退出');

    await mgr.stop();
    restore();
  });

  it('stop 后子进程退出不触发重启', async () => {
    const restore = disableSha256();
    const zipBuf = makeZip();
    let healthCalls = 0;
    globalThis.fetch = mock((url: string | URL) => {
      if (String(url).includes('/health')) {
        healthCalls += 1;
        return Promise.resolve(healthRes(healthCalls > 1));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => zipBuf,
      });
    }) as typeof fetch;

    const mgr = new LlamaCppServerManager(() => ({
      model: '/tmp/models/x.gguf',
    }));
    await mgr.start();
    await mgr.stop();

    // stop 后崩溃退出 → 不重启
    procs[0]._emit('exit', 1, null);
    await new Promise((r) => setTimeout(r, 10));

    const status = await mgr.getStatus();
    expect(status.restartCount).toBe(0);
    expect(status.status).toBe('stopped');
    restore();
  });
});
