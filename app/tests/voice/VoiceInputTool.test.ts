/**
 * VoiceInputTool 单元测试
 *
 * 覆盖语音识别工具的完整接口：
 * - getInfo() 工具信息
 * - validateInput() 输入验证
 * - userFacingName() 用户面名称
 * - getActivityDescription() 活动描述
 * - getToolUseSummary() 工具使用摘要
 * - execute() 各 action 路径（mock voiceService）
 * - 边界情况（重复 start、未录音时 stop、未知 action）
 */

import { describe, it, expect, mock, afterAll, beforeEach } from 'bun:test';

// ============================================================
// Mock voiceService：模拟录音、识别、依赖检查
// ============================================================
const mockVoiceService = {
  startRecording: mock(
    (_onData: (chunk: Buffer) => void, _onEnd: () => void) =>
      Promise.resolve(true)
  ),
  stopRecording: mock(() => {}),
  recognize: mock((_audioData: Buffer) =>
    Promise.resolve({
      text: '识别结果文本',
      confidence: 0.95,
      isFinal: true,
      duration: 2.5,
      provider: 'cloud',
    })
  ),
  checkRecordingAvailability: mock(() =>
    Promise.resolve({
      available: true,
      missing: [],
      installCommand: null,
      method: 'sox',
      reason: null,
    })
  ),
  checkVoiceDependencies: mock(() =>
    Promise.resolve({
      available: true,
      missing: [],
      installCommand: null,
      method: 'sox',
      reason: null,
    })
  ),
};

mock.module('@modules/services/voice', () => ({
  default: mockVoiceService,
  VoiceService: class {},
  createVoiceService: () => mockVoiceService,
}));

// 动态导入
const { VoiceInputTool } = await import(
  '../../src/tools/VoiceInputTool/VoiceInputTool'
);
const { validateVoiceInputInput } = await import(
  '../../src/tools/VoiceInputTool/schemas'
);
const {
  VOICE_INPUT_TOOL_NAME,
  VOICE_INPUT_DESCRIPTION,
  VOICE_INPUT_ALIASES,
} = await import('../../src/tools/VoiceInputTool/constants');

// 恢复
afterAll(() => {
  mock.module('@modules/services/voice', () =>
    require('@modules/services/voice')
  );
});

// ============================================================
// schemas 验证函数测试
// ============================================================

describe('validateVoiceInputInput', () => {
  it('action=start 应该验证成功', () => {
    const result = validateVoiceInputInput({ action: 'start' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe('start');
    }
  });

  it('action=stop 应该验证成功', () => {
    const result = validateVoiceInputInput({ action: 'stop' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe('stop');
    }
  });

  it('action=check 应该验证成功', () => {
    const result = validateVoiceInputInput({ action: 'check' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe('check');
    }
  });

  it('缺少 action 应该验证失败', () => {
    const result = validateVoiceInputInput({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('action');
    }
  });

  it('无效 action 应该验证失败', () => {
    const result = validateVoiceInputInput({ action: 'pause' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('action');
    }
  });

  it('传 null 应该验证失败', () => {
    const result = validateVoiceInputInput(null);
    expect(result.success).toBe(false);
  });

  it('传 undefined 应该验证失败', () => {
    const result = validateVoiceInputInput(undefined);
    expect(result.success).toBe(false);
  });

  it('应支持 language 选项', () => {
    const result = validateVoiceInputInput({
      action: 'start',
      language: 'en-US',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.language).toBe('en-US');
    }
  });
});

// ============================================================
// VoiceInputTool 测试
// ============================================================

describe('VoiceInputTool', () => {
  let tool: InstanceType<typeof VoiceInputTool>;

  beforeEach(() => {
    tool = new VoiceInputTool();
    // 重置 mock 状态
    mockVoiceService.startRecording.mockClear();
    mockVoiceService.stopRecording.mockClear();
    mockVoiceService.recognize.mockClear();
  });

  describe('getInfo()', () => {
    it('应返回正确的工具名称', () => {
      const info = tool.getInfo();
      expect(info.name).toBe(VOICE_INPUT_TOOL_NAME);
    });

    it('应返回正确的工具描述', () => {
      const info = tool.getInfo();
      expect(info.description).toBe(VOICE_INPUT_DESCRIPTION);
    });

    it('params 应包含 action 和 language', () => {
      const info = tool.getInfo();
      expect(info.params.length).toBe(2);

      const actionParam = info.params.find((p) => p.name === 'action');
      expect(actionParam).toBeDefined();
      expect(actionParam?.required).toBe(true);
      expect(actionParam?.enum).toEqual(['start', 'stop', 'check']);

      const langParam = info.params.find((p) => p.name === 'language');
      expect(langParam).toBeDefined();
      expect(langParam?.required).toBe(false);
      expect(langParam?.default).toBe('zh-CN');
    });

    it('enabled 应为 true', () => {
      expect(tool.getInfo().enabled).toBe(true);
    });

    it('readOnly 应为 false', () => {
      expect(tool.getInfo().readOnly).toBe(false);
    });

    it('destructive 应为 false', () => {
      expect(tool.getInfo().destructive).toBe(false);
    });

    it('concurrencySafe 应为 true', () => {
      expect(tool.getInfo().concurrencySafe).toBe(true);
    });

    it('alwaysLoad 应为 false', () => {
      expect(tool.getInfo().alwaysLoad).toBe(false);
    });

    it('deferred 应为 false', () => {
      expect(tool.getInfo().deferred).toBe(false);
    });

    it('interruptBehavior 应为 block', () => {
      expect(tool.getInfo().interruptBehavior).toBe('block');
    });

    it('tags 应包含 AI 标签', () => {
      const info = tool.getInfo();
      expect(info.tags).toBeDefined();
      expect(info.tags?.length).toBeGreaterThan(0);
    });
  });

  describe('isEnabled()', () => {
    it('应返回 true', () => {
      expect(tool.isEnabled()).toBe(true);
    });
  });

  describe('isReadOnly()', () => {
    it('应返回 false', () => {
      expect(tool.isReadOnly()).toBe(false);
      expect(tool.isReadOnly({ action: 'start' })).toBe(false);
      expect(tool.isReadOnly({ action: 'stop' })).toBe(false);
    });
  });

  describe('isDestructive()', () => {
    it('应返回 false', () => {
      expect(tool.isDestructive()).toBe(false);
      expect(tool.isDestructive({ action: 'start' })).toBe(false);
    });
  });

  describe('isConcurrencySafe()', () => {
    it('应返回 true', () => {
      expect(tool.isConcurrencySafe()).toBe(true);
      expect(tool.isConcurrencySafe({ action: 'stop' })).toBe(true);
    });
  });

  describe('validateInput()', () => {
    it('有效 action=start 应验证通过', () => {
      const result = tool.validateInput({ action: 'start' });
      expect(result.result).toBe(true);
    });

    it('有效 action=stop 应验证通过', () => {
      const result = tool.validateInput({ action: 'stop' });
      expect(result.result).toBe(true);
    });

    it('有效 action=check 应验证通过', () => {
      const result = tool.validateInput({ action: 'check' });
      expect(result.result).toBe(true);
    });

    it('缺少 action 应验证失败', () => {
      const result = tool.validateInput({});
      expect(result.result).toBe(false);
      if (!result.result) {
        expect(result.message).toContain('Missing required parameter');
      }
    });

    it('无效 action 应验证失败', () => {
      const result = tool.validateInput({ action: 'pause' });
      expect(result.result).toBe(false);
      if (!result.result) {
        expect(result.message).toContain('action must be one of');
      }
    });

    it('无效 action=delete 应验证失败', () => {
      const result = tool.validateInput({ action: 'delete' });
      expect(result.result).toBe(false);
    });
  });

  describe('userFacingName()', () => {
    it('action=start 应返回录音中名称', () => {
      expect(tool.userFacingName({ action: 'start' })).toBe(
        'Voice Input (Recording)'
      );
    });

    it('action=stop 应返回处理中名称', () => {
      expect(tool.userFacingName({ action: 'stop' })).toBe(
        'Voice Input (Processing)'
      );
    });

    it('action=check 或无输入应返回默认名称', () => {
      expect(tool.userFacingName({ action: 'check' })).toBe('Voice Input');
      expect(tool.userFacingName()).toBe('Voice Input');
    });
  });

  describe('getActivityDescription()', () => {
    it('action=start 应返回启动描述', () => {
      expect(tool.getActivityDescription({ action: 'start' })).toBe(
        'Starting voice input'
      );
    });

    it('action=stop 应返回处理描述', () => {
      expect(tool.getActivityDescription({ action: 'stop' })).toBe(
        'Processing voice input'
      );
    });

    it('action=check 应返回检查描述', () => {
      expect(tool.getActivityDescription({ action: 'check' })).toBe(
        'Checking voice input status'
      );
    });

    it('无 action 或未知 action 应返回 null', () => {
      expect(tool.getActivityDescription()).toBeNull();
      expect(tool.getActivityDescription({ action: 'unknown' })).toBeNull();
    });
  });

  describe('getToolUseSummary()', () => {
    it('action=start 应返回启动摘要', () => {
      expect(tool.getToolUseSummary({ action: 'start' })).toBe(
        'Start voice recording'
      );
    });

    it('action=stop 应返回停止摘要', () => {
      expect(tool.getToolUseSummary({ action: 'stop' })).toBe(
        'Stop recording and recognize speech'
      );
    });

    it('action=check 应返回检查摘要', () => {
      expect(tool.getToolUseSummary({ action: 'check' })).toBe(
        'Check voice input availability'
      );
    });

    it('无输入应返回 null', () => {
      expect(tool.getToolUseSummary()).toBeNull();
    });

    it('无 action 应返回 null', () => {
      expect(tool.getToolUseSummary({})).toBeNull();
    });
  });

  // ============================================================
  // execute() 测试
  // ============================================================

  describe('execute() — action=start', () => {
    it('录音成功应返回 SUCCESS 状态', async () => {
      const result = await tool.execute({ action: 'start' });

      expect(result.status).toBe('success');
      expect(result.output).toBe('语音输入已启动，请开始说话');
      expect(result.error).toBeUndefined();
    });

    it('返回 result 应包含 recording=true', async () => {
      const result = await tool.execute({ action: 'start', language: 'en' });

      expect(result.result).toEqual({ recording: true, language: 'en' });
    });

    it('metadata 应包含 language', async () => {
      const result = await tool.execute({ action: 'start', language: 'zh-CN' });

      expect(result.metadata).toEqual({ language: 'zh-CN' });
    });

    it('未传 language 时默认使用 zh-CN', async () => {
      const result = await tool.execute({ action: 'start' });

      expect(result.result).toEqual({ recording: true, language: 'zh-CN' });
    });

    it('录音启动失败应返回 FAILURE 状态', async () => {
      mockVoiceService.startRecording.mockImplementationOnce(() =>
        Promise.resolve(false)
      );

      const result = await tool.execute({ action: 'start' });

      expect(result.status).toBe('failure');
      expect(result.error).toBe('Failed to start recording');
    });

    it('voiceService 抛出异常时不应崩溃', async () => {
      mockVoiceService.startRecording.mockImplementationOnce(() => {
        throw new Error('模拟录音故障');
      });

      const result = await tool.execute({ action: 'start' });

      expect(result.status).toBe('failure');
      expect(result.error).toContain('模拟录音故障');
    });
  });

  describe('execute() — action=stop', () => {
    it('未在录音时 stop 应返回 FAILURE', async () => {
      const result = await tool.execute({ action: 'stop' });

      expect(result.status).toBe('failure');
      expect(result.error).toBe('No recording in progress');
    });

    it('start 后 stop 应返回识别结果', async () => {
      // 先 start
      await tool.execute({ action: 'start' });

      // 再 stop
      const result = await tool.execute({ action: 'stop' });

      expect(result.status).toBe('success');
      // 识别结果经 result.result.text（成功路径）或 result.output 返回
      expect(
        (result.result as { text?: string } | null)?.text || result.output
      ).toBeDefined();
    });

    it('正常 stop 应调用 recognize', async () => {
      await tool.execute({ action: 'start' });
      await tool.execute({ action: 'stop' });

      // recognize 应被调用且收到音频数据
      expect(mockVoiceService.recognize).toHaveBeenCalled();
    });
  });

  describe('execute() — action=check', () => {
    it('应返回依赖检查结果', async () => {
      const result = await tool.execute({ action: 'check' });

      expect(result.status).toBe('success');
      expect(result.result).toBeDefined();
      if (result.result) {
        const checkResult = result.result as Record<string, unknown>;
        expect(typeof checkResult.recording).toBe('boolean');
        expect(typeof checkResult.available).toBe('boolean');
        expect(typeof checkResult.dependenciesAvailable).toBe('boolean');
        expect(Array.isArray(checkResult.missing)).toBe(true);
      }
    });

    it('应检查录音可用性和语音依赖', async () => {
      await tool.execute({ action: 'check' });

      expect(mockVoiceService.checkRecordingAvailability).toHaveBeenCalled();
      expect(mockVoiceService.checkVoiceDependencies).toHaveBeenCalled();
    });
  });

  describe('execute() — 未知 action', () => {
    it('应返回 FAILURE 状态', async () => {
      const result = await tool.execute({ action: 'unknown' });

      expect(result.status).toBe('failure');
      expect(result.error).toContain('Unknown action');
    });
  });

  describe('execute() — 组合场景', () => {
    it('重复 start 应返回错误', async () => {
      await tool.execute({ action: 'start' });

      const result = await tool.execute({ action: 'start' });

      expect(result.status).toBe('failure');
      expect(result.error).toBe('Recording already in progress');
    });

    it('start → stop → start 应正常（先停止再重新开始）', async () => {
      // 第一次录音
      await tool.execute({ action: 'start' });
      const stopResult = await tool.execute({ action: 'stop' });
      expect(stopResult.status).toBe('success');

      // 第二次录音
      const startResult = await tool.execute({ action: 'start' });
      expect(startResult.status).toBe('success');
    });

    it('stop → stop 重复停止应返回错误', async () => {
      await tool.execute({ action: 'start' });
      await tool.execute({ action: 'stop' });

      const result = await tool.execute({ action: 'stop' });
      expect(result.status).toBe('failure');
      expect(result.error).toBe('No recording in progress');
    });

    it('check 不依赖录音状态，随时可用', async () => {
      // 未录音时 check
      const before = await tool.execute({ action: 'check' });
      expect(before.status).toBe('success');

      // 录音中 check
      await tool.execute({ action: 'start' });
      const during = await tool.execute({ action: 'check' });
      expect(during.status).toBe('success');
      expect((during.result as Record<string, unknown>)?.recording).toBe(true);

      // 停止后 check
      await tool.execute({ action: 'stop' });
      const after = await tool.execute({ action: 'check' });
      expect(after.status).toBe('success');
      expect((after.result as Record<string, unknown>)?.recording).toBe(false);
    });
  });
});
