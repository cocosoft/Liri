/**
 * ffmpeg 管道转换单元测试（P3 合并 ffmpeg 管道后回归保护）
 * mock child_process.spawn，不依赖真实 ffmpeg 安装。
 * 覆盖 ffmpegPipeConvert 参数组装 + transcodeToPcm16 固定参数委托。
 */

import { describe, it, expect, mock } from 'bun:test';
import { EventEmitter } from 'events';

type FakeProc = {
  stdin: { write: ReturnType<typeof mock>; end: ReturnType<typeof mock> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  on: ReturnType<typeof mock>;
  _emit: (evt: string, ...payload: unknown[]) => void;
};

const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
const procs: FakeProc[] = [];

mock.module('child_process', () => {
  return {
    spawn: (cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const stdin = { write: mock(), end: mock() };
      const handlers: Record<string, (payload: unknown) => void> = {};
      const proc = {
        stdin,
        stdout,
        stderr,
        on: (evt: string, cb: (payload: unknown) => void) => {
          handlers[evt] = cb;
          return proc;
        },
        _emit: (evt: string, ...payload: unknown[]) => {
          handlers[evt]?.(payload[0]);
        },
      } as FakeProc;
      procs.push(proc);
      return proc;
    },
  };
});

import {
  transcodeToPcm16,
  ffmpegPipeConvert,
} from '../../src/services/voice/services/audioNormalizer.js';

describe('ffmpegPipeConvert（参数化管道转码）', () => {
  it('组装 ffmpeg 管道参数并写入 stdin', async () => {
    const input = Buffer.from([1, 2, 3]);
    const promise = ffmpegPipeConvert(input, {
      outputFormat: 'wav',
      sampleRate: 44100,
      channels: 2,
    });

    expect(spawnCalls[spawnCalls.length - 1]).toEqual({
      cmd: 'ffmpeg',
      args: ['-i', 'pipe:0', '-f', 'wav', '-ar', '44100', '-ac', '2', 'pipe:1'],
    });

    const proc = procs[procs.length - 1];
    expect(proc.stdin.write).toHaveBeenCalledWith(input);
    expect(proc.stdin.end).toHaveBeenCalled();

    proc.stdout.emit('data', Buffer.from([10, 20]));
    proc._emit('close', 0);
    await expect(promise).resolves.toEqual(Buffer.from([10, 20]));
  });

  it('close 非 0 退出码时 reject', async () => {
    const promise = ffmpegPipeConvert(Buffer.alloc(4), {
      outputFormat: 's16le',
      sampleRate: 16000,
      channels: 1,
    });

    const proc = procs[procs.length - 1];
    proc._emit('close', 1);
    await expect(promise).rejects.toThrow(/退出码 1/);
  });

  it('spawn error 时 reject', async () => {
    const promise = ffmpegPipeConvert(Buffer.alloc(4), {
      outputFormat: 's16le',
      sampleRate: 16000,
      channels: 1,
    });

    const proc = procs[procs.length - 1];
    proc._emit('error', new Error('ENOENT'));
    await expect(promise).rejects.toThrow('ENOENT');
  });
});

describe('transcodeToPcm16（固定参数委托）', () => {
  it('委托 ffmpegPipeConvert 传 16kHz mono s16le 固定参数', async () => {
    const promise = transcodeToPcm16(Buffer.from([5, 6]));

    expect(spawnCalls[spawnCalls.length - 1]).toEqual({
      cmd: 'ffmpeg',
      args: ['-i', 'pipe:0', '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1'],
    });

    const proc = procs[procs.length - 1];
    proc.stdout.emit('data', Buffer.from([7, 8]));
    proc._emit('close', 0);
    await expect(promise).resolves.toEqual(Buffer.from([7, 8]));
  });
});
