// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * drainStdin — 丢弃 stdin 中待处理的字节
 *
 * 确保退出后 in-flight 的转义序列（鼠标追踪报告、bracketed-paste 标记）
 * 不会泄漏到 shell。
 *
 * 两层棘手之处：
 *
 * 1. setRawMode 是 termios 而非 fcntl — stdin fd 保持阻塞模式，
 *    readSync 会永远挂起。Node 不暴露 fcntl，因此用 O_NONBLOCK
 *    重新打开 /dev/tty（所有指向控制终端的 fd 共享一个 line-discipline
 *    输入队列）。
 *
 * 2. forceExit 调用此函数时，detachForShutdown 已将 TTY 恢复为 cooked
 *    （规范）模式。规范模式会缓冲输入直到换行符，因此 O_NONBLOCK 读取
 *    即使缓冲区中有鼠标字节也会返回 EAGAIN。我们短暂重新进入 raw 模式，
 *    让读取能拿到可用字节，然后恢复 cooked 模式。
 *
 * 可安全多次调用。在退出路径中尽可能晚地调用：
 * patchConsole restore → forceExit → detachForShutdown → drainStdin。
 *
 * DISABLE_MOUSE_TRACKING 存在终端往返延迟，写入后事件可能还会
 * 持续几毫秒到达。
 */

import { closeSync, constants as fsConstants, openSync, readSync } from 'fs';

export function drainStdin(stdin: NodeJS.ReadStream = process.stdin): void {
  if (!stdin.isTTY) return;

  // Drain Node's stream buffer（libuv 已拉入的字节）
  try {
    while (stdin.read() !== null) {
      /* discard */
    }
  } catch {
    /* stream may be destroyed */
  }

  // Windows 没有 /dev/tty；CONIN$ 不支持 O_NONBLOCK 语义
  if (process.platform === 'win32') return;

  const tty = stdin as NodeJS.ReadStream & {
    isRaw?: boolean;
    setRawMode?: (raw: boolean) => void;
  };
  const wasRaw = tty.isRaw === true;

  let fd = -1;
  try {
    if (!wasRaw) tty.setRawMode?.(true);
    fd = openSync('/dev/tty', fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    const buf = Buffer.alloc(1024);
    for (let i = 0; i < 64; i++) {
      if (readSync(fd, buf, 0, buf.length, null) <= 0) break;
    }
  } catch {
    // EAGAIN, ENXIO/ENOENT, EBADF/EIO
  } finally {
    if (fd >= 0) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    if (!wasRaw) {
      try {
        tty.setRawMode?.(false);
      } catch {
        /* TTY may be gone */
      }
    }
  }
}
