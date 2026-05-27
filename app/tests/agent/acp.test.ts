/**
 * ACP (Agent Communication Protocol) 单元测试
 * 覆盖 AcpServer 和 AcpClient
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { AcpServer } from '../../src/agent/acp/AcpServer.js';
import { AcpClient } from '../../src/agent/acp/AcpClient.js';
import type { AcpMessage, AcpHandler } from '../../src/agent/acp/index.js';

describe('AcpServer', () => {
  let server: AcpServer;

  beforeEach(() => {
    server = new AcpServer({ serverId: 'test-server' });
    server.start();
  });

  afterEach(() => {
    server.stop();
  });

  it('创建服务端实例并启动', () => {
    const s = new AcpServer({ serverId: 'new-server' });
    expect(s).toBeDefined();
    s.start();
    s.stop();
  });

  it('连接会话', () => {
    const session = server.connectSession('client-1', { role: 'test' });

    expect(session).toBeDefined();
    expect(session.clientId).toBe('client-1');
    expect(session.state).toBe('connected');
    expect(session.serverId).toBe('test-server');
  });

  it('断开会话', () => {
    const session = server.connectSession('client-1');
    expect(server.getSessionCount()).toBe(1);

    server.disconnectSession(session.id);
    expect(server.getSessionCount()).toBe(0);
  });

  it('列出所有会话', () => {
    server.connectSession('client-1');
    server.connectSession('client-2');

    const sessions = server.listSessions();
    expect(sessions.length).toBe(2);
  });

  it('注册处理器并处理消息', async () => {
    const session = server.connectSession('client-1');

    const handler: AcpHandler = async (msg: AcpMessage) => {
      return {
        id: `resp_${Date.now()}`,
        type: 'response',
        source: 'test-server',
        target: msg.source,
        priority: 'normal',
        timestamp: Date.now(),
        correlationId: msg.id,
        payload: { result: 'pong' },
      };
    };

    server.registerHandler('echo', handler);

    const response = await server.handleMessage({
      id: 'msg_1',
      type: 'request',
      source: session.clientId,
      target: 'test-server',
      method: 'echo',
      payload: { text: 'hello' },
      priority: 'normal',
      timestamp: Date.now(),
    });

    expect(response.type).toBe('response');
    expect((response.payload as any).result).toBe('pong');
  });

  it('处理 ping 消息返回 pong', async () => {
    const session = server.connectSession('client-1');

    const response = await server.handleMessage({
      id: 'ping_1',
      type: 'ping',
      source: session.clientId,
      target: 'test-server',
      priority: 'low',
      timestamp: Date.now(),
    });

    expect(response.type).toBe('pong');
  });

  it('未知方法返回 error', async () => {
    const session = server.connectSession('client-1');

    const response = await server.handleMessage({
      id: 'msg_1',
      type: 'request',
      source: session.clientId,
      target: 'test-server',
      method: 'unknown_method',
      payload: {},
      priority: 'normal',
      timestamp: Date.now(),
    });

    expect(response.type).toBe('error');
  });

  it('处理器抛出异常时返回 error', async () => {
    const session = server.connectSession('client-1');

    const handler: AcpHandler = async () => {
      throw new Error('handler error');
    };

    server.registerHandler('failing', handler);

    const response = await server.handleMessage({
      id: 'msg_1',
      type: 'request',
      source: session.clientId,
      target: 'test-server',
      method: 'failing',
      payload: {},
      priority: 'normal',
      timestamp: Date.now(),
    });

    expect(response.type).toBe('error');
  });

  it('未找到会话时返回 error', async () => {
    const response = await server.handleMessage({
      id: 'msg_1',
      type: 'request',
      source: 'unknown-client',
      target: 'test-server',
      method: 'echo',
      payload: {},
      priority: 'normal',
      timestamp: Date.now(),
    });

    expect(response.type).toBe('error');
  });

  it('达到最大会话数时拒绝新连接', () => {
    const smallServer = new AcpServer({ serverId: 'small', maxSessions: 2 });
    smallServer.start();

    smallServer.connectSession('client-1');
    smallServer.connectSession('client-2');

    expect(() => {
      smallServer.connectSession('client-3');
    }).toThrow();
    smallServer.stop();
  });

  it('start/stop 事件触发', () => {
    const s = new AcpServer({ serverId: 'event-test' });

    let started = false;
    let stopped = false;

    s.on('started', () => { started = true; });
    s.on('stopped', () => { stopped = true; });

    s.start();
    expect(started).toBe(true);

    s.stop();
    expect(stopped).toBe(true);
  });

  it('连接/断开事件触发', () => {
    let connected = false;
    let disconnected = false;

    server.on('session:connected', () => { connected = true; });
    server.on('session:disconnected', () => { disconnected = true; });

    const session = server.connectSession('event-client');
    expect(connected).toBe(true);

    server.disconnectSession(session.id);
    expect(disconnected).toBe(true);
  });

});

describe('AcpClient', () => {
  let server: AcpServer;
  let client: AcpClient;

  beforeEach(() => {
    server = new AcpServer({ serverId: 'test-server' });
    server.start();
    client = new AcpClient('test-client', 'test-server');
  });

  afterEach(() => {
    client.disconnect();
    server.stop();
  });

  it('创建客户端实例', () => {
    const c = AcpClient.create('c1', 's1');
    expect(c).toBeDefined();
    expect(c.isConnected()).toBe(false);
  });

  it('连接', () => {
    client.connect();
    expect(client.isConnected()).toBe(true);
  });

  it('断开', () => {
    client.connect();
    expect(client.isConnected()).toBe(true);

    client.disconnect();
    expect(client.isConnected()).toBe(false);
  });

  it('绑定服务端后发送消息', async () => {
    const session = server.connectSession('test-client');
    client.bindServer(server);
    client.connect(session);

    server.registerHandler('echo', async (msg) => ({
      id: `resp_${Date.now()}`,
      type: 'response',
      source: 'test-server',
      target: msg.source,
      priority: 'normal',
      timestamp: Date.now(),
      correlationId: msg.id,
      payload: { result: msg.payload },
    }));

    const response = await client.send('echo', { text: 'hello' });
    expect(response.type).toBe('response');
    expect((response.payload as any).result.text).toBe('hello');
  });

  it('未连接时发送消息抛出异常', async () => {
    expect(client.isConnected()).toBe(false);

    try {
      await client.send('echo', {});
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it('ping 返回 true（发送 type=ping 消息时）', async () => {
    const session = server.connectSession('test-client');
    client.bindServer(server);
    client.connect(session);

    // 当服务器收到 type='ping' 的消息时，返回 type='pong'
    const response = await server.handleMessage({
      id: 'test_ping',
      type: 'ping',
      source: 'test-client',
      target: server['config'].serverId,
      priority: 'low',
      timestamp: Date.now(),
    });

    expect(response.type).toBe('pong');
  });

  it('客户端 ping 返回 false（默认 __ping__ 方法无处理器）', async () => {
    const session = server.connectSession('test-client2');
    client.bindServer(server);
    client.connect(session);

    const result = await client.ping();
    expect(result).toBe(false);
  });

  it('断开连接后 ping 返回 false', async () => {
    client.connect();
    client.disconnect();

    const result = await client.ping();
    expect(result).toBe(false);
  });

  it('连接/断开事件触发', () => {
    let connected = false;
    let disconnected = false;

    client.on('connected', () => { connected = true; });
    client.on('disconnected', () => { disconnected = true; });

    client.connect();
    expect(connected).toBe(true);

    client.disconnect();
    expect(disconnected).toBe(true);
  });

});
