/**
 * B3-a（2026-09-26，《Liri 优化方案》）：镜像管理器**不再同步阻塞事件循环**。
 *
 * 改前 `DockerImageManager` 全部方法走 `execSync`（`pullImage` 超时 120s）⇒ 拉镜像期间
 * daemon 内**全部 HTTP/SSE 停摆**。改后走**可注入的异步 CLI 执行器**。
 *
 * 本文件用**假执行器**离线锁定三件事（无需本机装 Docker）：
 *  ① 调用真的经过执行器（若有人改回 `execSync`，执行器不会被调用 ⇒ 用例红）；
 *  ② 调用期间**事件循环不被阻塞**（并发计时器先触发）；
 *  ③ 各方法的成败分支（失败返回 false/[]/null，不抛）。
 */
import { describe, expect, it } from 'bun:test';
import { DockerImageManager } from '../../src/sandbox/docker/DockerImageManager';
import type { DockerCliResult } from '../../src/sandbox/docker/dockerCli';

function ok(stdout = ''): DockerCliResult {
  return { code: 0, stdout, stderr: '', ok: true, timedOut: false };
}

function fail(message = 'docker: command not found'): DockerCliResult {
  return {
    code: null,
    stdout: '',
    stderr: message,
    ok: false,
    timedOut: false,
    error: new Error(message),
  };
}

describe('B3-a: 事件循环不被阻塞（关键修复）', () => {
  /**
   * ⚠️ 判据必须是**计时**而不是"顺序"：仅比较事件顺序时，`await` **之前**的同步阻塞
   * （正是 `execSync` 的形态）不会被抓到 —— 因为阻塞结束后 'run' 会**同步**先入队，
   * 过期计时器只能排在它后面。故改为断言"计时器按约定期限触发"。
   */
  it('pullImage 期间计时器**按约定期限**触发（被同步阻塞则显著推迟）', async () => {
    const manager = new DockerImageManager(async () => {
      await new Promise((r) => setTimeout(r, 80));
      return ok();
    });

    const t0 = Date.now();
    // 注意：**不要 await** 这个计时器，否则 pull 会在计时器之后才启动，等于没测
    const fired = new Promise<number>((resolve) => {
      setTimeout(() => resolve(Date.now() - t0), 10);
    });
    const pulling = manager.pullImage('node:24-alpine');
    const firedAt = await fired;
    expect(await pulling).toBe(true);

    // 阈值说明：期限 10ms、异步工作量 80ms、模拟阻塞 60ms ⇒ 40ms 可稳定区分
    expect(firedAt).toBeLessThan(40);
  });

  it('调用确实经过**注入的**异步执行器（改回 execSync/绕过注入即红）', async () => {
    const seen: string[][] = [];
    const manager = new DockerImageManager(async (args) => {
      seen.push(args);
      return ok();
    });

    await manager.imageExists('node:24-alpine');
    await manager.pullImage('node:24-alpine');

    expect(seen).toEqual([
      ['image', 'inspect', 'node:24-alpine'],
      ['pull', 'node:24-alpine'],
    ]);
  });
});

describe('B3-a: 成败分支（失败不抛，返回可判定的降级值）', () => {
  it('imageExists：镜像存在 ⇒ true；不存在 ⇒ false（且不再按 ERROR 记账）', async () => {
    const yes = new DockerImageManager(async () => ok('[]'));
    expect(await yes.imageExists('node:24-alpine')).toBe(true);

    const no = new DockerImageManager(async () => fail('No such image'));
    expect(await no.imageExists('missing')).toBe(false);
  });

  it('pullImage：失败 ⇒ false（不抛）；带 platform ⇒ 参数含 --platform', async () => {
    const seen: string[][] = [];
    const manager = new DockerImageManager(async (args) => {
      seen.push(args);
      return fail('pull failed');
    });
    expect(await manager.pullImage('node:24-alpine', 'linux/amd64')).toBe(
      false
    );
    expect(seen).toEqual([
      ['pull', 'node:24-alpine', '--platform', 'linux/amd64'],
    ]);

    const fine = new DockerImageManager(async () => ok());
    expect(await fine.pullImage('node:24-alpine')).toBe(true);
  });

  it('listImages：解析 tab 分隔行；失败 ⇒ []', async () => {
    const stdout = [
      'node\t24-alpine\tabc123\t2026-01-01\t100MB',
      'python\t3.12\tsha256:def\t2026-02-02\t200MB',
    ].join('\n');
    const manager = new DockerImageManager(async () => ok(stdout));
    const list = await manager.listImages();
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      repository: 'node',
      tag: '24-alpine',
      imageId: 'abc123',
      created: '2026-01-01',
      size: '100MB',
    });

    const broken = new DockerImageManager(async () => fail());
    expect(await broken.listImages()).toEqual([]);
  });

  it('getImageSize：失败 ⇒ null；成功 ⇒ trim 后的值', async () => {
    const bad = new DockerImageManager(async () => fail());
    expect(await bad.getImageSize('missing')).toBeNull();

    const good = new DockerImageManager(async () => ok('  12345\n'));
    expect(await good.getImageSize('node:24-alpine')).toBe('12345');
  });

  it('removeImage：force ⇒ 参数含 -f；失败 ⇒ false', async () => {
    const seen: string[][] = [];
    const manager = new DockerImageManager(async (args) => {
      seen.push(args);
      return ok();
    });
    expect(await manager.removeImage('node:24-alpine', true)).toBe(true);
    expect(seen).toEqual([['rmi', '-f', 'node:24-alpine']]);

    const bad = new DockerImageManager(async () => fail());
    expect(await bad.removeImage('node:24-alpine')).toBe(false);
  });

  it('buildImage：tag 与 build-arg 进入参数；失败 ⇒ false', async () => {
    const seen: string[][] = [];
    const manager = new DockerImageManager(async (args) => {
      seen.push(args);
      return ok();
    });
    expect(
      await manager.buildImage('/ctx', {
        tag: 'my-img:1',
        buildArgs: { A: '1' },
      })
    ).toBe(true);
    expect(seen[0]).toEqual([
      'build',
      '-t',
      'my-img:1',
      '--build-arg',
      'A=1',
      '/ctx',
    ]);
  });

  it('pruneImages：成功 ⇒ 0；失败 ⇒ -1（不抛）', async () => {
    const good = new DockerImageManager(async () =>
      ok('Total reclaimed space: 1.2GB')
    );
    expect(await good.pruneImages()).toBe(0);

    const bad = new DockerImageManager(async () => fail());
    expect(await bad.pruneImages(true)).toBe(-1);
  });
});
