/**
 * 国际化（i18n）框架扩展
 * 对标 Hermes locales/ 目录结构
 * 在现有 core/i18n/ 基础上扩展翻译注册和管理能力
 */

/**
 * 翻译条目
 */
export interface TranslationEntry {
  key: string;
  zh: string;
  en: string;
  ja?: string;
  ko?: string;
  [locale: string]: string | undefined;
}

/**
 * 支持的 locale
 */
export type SupportedLocale = 'zh' | 'en' | 'ja' | 'ko';

/**
 * 检测系统语言环境
 * 优先级: 环境变量 > Intl API > 默认中文
 * @returns 检测到的 locale
 */
export function detectSystemLocale(): SupportedLocale {
  const envLocale =
    process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES;

  if (envLocale) {
    const normalized = envLocale.toLowerCase();
    if (normalized.includes('ja')) return 'ja';
    if (normalized.includes('ko')) return 'ko';
    if (normalized.includes('en') || normalized.includes('us')) return 'en';
    if (normalized.includes('zh') || normalized.includes('cn')) return 'zh';
  }

  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale.startsWith('zh')) return 'zh';
    if (intlLocale.startsWith('en')) return 'en';
    if (intlLocale.startsWith('ja')) return 'ja';
    if (intlLocale.startsWith('ko')) return 'ko';
  } catch {
    // Intl API 不可用时静默降级
  }

  return 'zh';
}

/**
 * 翻译注册表扩展
 */
export class I18nTranslationRegistry {
  private translations: Map<string, TranslationEntry> = new Map();
  private fallbackLocale: SupportedLocale = 'zh';
  private currentLocale: SupportedLocale = detectSystemLocale();

  /**
   * 设置当前 locale
   * @param locale 地区
   */
  setLocale(locale: SupportedLocale): void {
    this.currentLocale = locale;
  }

  /**
   * 获取当前 locale
   */
  getLocale(): SupportedLocale {
    return this.currentLocale;
  }

  /**
   * 设置回退 locale
   * @param locale 地区
   */
  setFallbackLocale(locale: SupportedLocale): void {
    this.fallbackLocale = locale;
  }

  /**
   * 注册翻译条目
   * @param entry 翻译条目
   */
  register(entry: TranslationEntry): void {
    this.translations.set(entry.key, entry);
  }

  /**
   * 批量注册翻译条目
   * @param entries 翻译条目列表
   */
  registerBatch(entries: TranslationEntry[]): void {
    for (const entry of entries) {
      this.register(entry);
    }
  }

  /**
   * 翻译键值
   * @param key 翻译键
   * @param params 参数替换
   * @param locale 指定地区
   * @returns 翻译后的文本
   */
  t(
    key: string,
    params?: Record<string, string | number>,
    locale?: SupportedLocale
  ): string {
    const entry = this.translations.get(key);
    const targetLocale = locale || this.currentLocale;

    let text: string | undefined;

    if (entry) {
      text = entry[targetLocale];

      if (!text) {
        text = entry[this.fallbackLocale];
      }

      if (!text) {
        text = entry.zh || entry.en;
      }
    }

    if (!text) {
      return key;
    }

    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        text = text.replace(`{${paramKey}}`, String(paramValue));
      }
    }

    return text;
  }

  /**
   * 获取所有翻译键
   * @returns 键列表
   */
  getKeys(): string[] {
    return Array.from(this.translations.keys());
  }

  /**
   * 获取所有翻译条目
   * @returns 条目列表
   */
  getAll(): TranslationEntry[] {
    return Array.from(this.translations.values());
  }

  /**
   * 获取翻译统计
   */
  getStats(): { total: number; languages: string[] } {
    const langs = new Set<string>();

    for (const entry of this.translations.values()) {
      for (const key of Object.keys(entry)) {
        if (key !== 'key' && entry[key]) {
          langs.add(key);
        }
      }
    }

    return {
      total: this.translations.size,
      languages: Array.from(langs),
    };
  }

  /**
   * 从 JSON 加载翻译
   * @param json JSON 数据
   */
  loadFromJSON(json: Record<string, Record<string, string>>): void {
    for (const [key, localeMap] of Object.entries(json)) {
      this.register({
        key,
        ...localeMap,
      } as TranslationEntry);
    }
  }

  /**
   * 导出为 JSON
   * @param locale 地区
   * @returns JSON 对象
   */
  exportAsJSON(locale?: SupportedLocale): Record<string, string> {
    const targetLocale = locale || this.currentLocale;
    const result: Record<string, string> = {};

    for (const [key, entry] of this.translations) {
      result[key] =
        entry[targetLocale] ||
        entry[this.fallbackLocale] ||
        entry.zh ||
        entry.en ||
        key;
    }

    return result;
  }

  /**
   * 清除所有翻译
   */
  clear(): void {
    this.translations.clear();
  }
}

/**
 * 全局翻译注册表
 */
let globalI18nRegistry: I18nTranslationRegistry | null = null;

/**
 * 获取全局 i18n 翻译注册表
 */
export function getI18nTranslationRegistry(): I18nTranslationRegistry {
  if (!globalI18nRegistry) {
    globalI18nRegistry = new I18nTranslationRegistry();
  }

  return globalI18nRegistry;
}

/**
 * 快捷翻译函数
 * @param key 翻译键
 * @param params 参数
 * @returns 翻译文本
 */
export function t(
  key: string,
  params?: Record<string, string | number>
): string {
  return getI18nTranslationRegistry().t(key, params);
}

/**
 * 初始化内置翻译
 * @param registry 注册表实例
 */
export function initializeBuiltinTranslations(
  registry: I18nTranslationRegistry
): void {
  const entries: TranslationEntry[] = [
    // ─── 通用 (common.*) ──────────────────────────────────────────
    { key: 'common.ok', zh: '确定', en: 'OK', ja: 'OK', ko: '확인' },
    {
      key: 'common.cancel',
      zh: '取消',
      en: 'Cancel',
      ja: 'キャンセル',
      ko: '취소',
    },
    {
      key: 'common.confirm',
      zh: '确认',
      en: 'Confirm',
      ja: '確認',
      ko: '확인',
    },
    { key: 'common.error', zh: '错误', en: 'Error', ja: 'エラー', ko: '오류' },
    {
      key: 'common.retry',
      zh: '重试',
      en: 'Retry',
      ja: 'リトライ',
      ko: '재시도',
    },
    {
      key: 'common.success',
      zh: '成功',
      en: 'Success',
      ja: '成功',
      ko: '성공',
    },
    { key: 'common.failed', zh: '失败', en: 'Failed', ja: '失敗', ko: '실패' },
    {
      key: 'common.warning',
      zh: '警告',
      en: 'Warning',
      ja: '警告',
      ko: '경고',
    },
    { key: 'common.info', zh: '信息', en: 'Info', ja: '情報', ko: '정보' },
    {
      key: 'common.loading',
      zh: '加载中...',
      en: 'Loading...',
      ja: '読み込み中...',
      ko: '로딩 중...',
    },
    {
      key: 'common.saving',
      zh: '保存中...',
      en: 'Saving...',
      ja: '保存中...',
      ko: '저장 중...',
    },
    { key: 'common.done', zh: '完成', en: 'Done', ja: '完了', ko: '완료' },
    { key: 'common.yes', zh: '是', en: 'Yes', ja: 'はい', ko: '예' },
    { key: 'common.no', zh: '否', en: 'No', ja: 'いいえ', ko: '아니오' },
    { key: 'common.close', zh: '关闭', en: 'Close', ja: '閉じる', ko: '닫기' },
    { key: 'common.open', zh: '打开', en: 'Open', ja: '開く', ko: '열기' },
    { key: 'common.save', zh: '保存', en: 'Save', ja: '保存', ko: '저장' },
    { key: 'common.delete', zh: '删除', en: 'Delete', ja: '削除', ko: '삭제' },
    { key: 'common.edit', zh: '编辑', en: 'Edit', ja: '編集', ko: '편집' },
    { key: 'common.search', zh: '搜索', en: 'Search', ja: '検索', ko: '검색' },
    {
      key: 'common.filter',
      zh: '筛选',
      en: 'Filter',
      ja: 'フィルター',
      ko: '필터',
    },
    {
      key: 'common.refresh',
      zh: '刷新',
      en: 'Refresh',
      ja: '更新',
      ko: '새로고침',
    },
    {
      key: 'common.reset',
      zh: '重置',
      en: 'Reset',
      ja: 'リセット',
      ko: '초기화',
    },
    { key: 'common.back', zh: '返回', en: 'Back', ja: '戻る', ko: '뒤로' },
    { key: 'common.next', zh: '下一步', en: 'Next', ja: '次へ', ko: '다음' },
    { key: 'common.submit', zh: '提交', en: 'Submit', ja: '送信', ko: '제출' },
    { key: 'common.copy', zh: '复制', en: 'Copy', ja: 'コピー', ko: '복사' },
    {
      key: 'common.paste',
      zh: '粘贴',
      en: 'Paste',
      ja: '貼り付け',
      ko: '붙여넣기',
    },
    { key: 'common.select', zh: '选择', en: 'Select', ja: '選択', ko: '선택' },
    { key: 'common.all', zh: '全部', en: 'All', ja: 'すべて', ko: '모두' },
    { key: 'common.none', zh: '无', en: 'None', ja: 'なし', ko: '없음' },
    {
      key: 'common.required',
      zh: '必填',
      en: 'Required',
      ja: '必須',
      ko: '필수',
    },
    {
      key: 'common.optional',
      zh: '可选',
      en: 'Optional',
      ja: '任意',
      ko: '선택사항',
    },
    {
      key: 'common.enabled',
      zh: '已启用',
      en: 'Enabled',
      ja: '有効',
      ko: '활성화됨',
    },
    {
      key: 'common.disabled',
      zh: '已禁用',
      en: 'Disabled',
      ja: '無効',
      ko: '비활성화됨',
    },
    {
      key: 'common.unknown',
      zh: '未知',
      en: 'Unknown',
      ja: '不明',
      ko: '알 수 없음',
    },
    {
      key: 'common.pending',
      zh: '待处理',
      en: 'Pending',
      ja: '保留中',
      ko: '보류 중',
    },
    {
      key: 'common.processing',
      zh: '处理中...',
      en: 'Processing...',
      ja: '処理中...',
      ko: '처리 중...',
    },
    {
      key: 'common.version',
      zh: '版本 {version}',
      en: 'Version {version}',
      ja: 'バージョン {version}',
      ko: '버전 {version}',
    },
    { key: 'common.example', zh: '示例', en: 'Example', ja: '例', ko: '예' },
    {
      key: 'common.default',
      zh: '默认',
      en: 'Default',
      ja: 'デフォルト',
      ko: '기본값',
    },
    {
      key: 'common.status',
      zh: '状态',
      en: 'Status',
      ja: 'ステータス',
      ko: '상태',
    },
    { key: 'common.list', zh: '列表', en: 'List', ja: 'リスト', ko: '목록' },

    // ─── 应用 (app.*) ────────────────────────────────────────────
    { key: 'app.name', zh: 'PY_APP', en: 'PY_APP', ja: 'PY_APP', ko: 'PY_APP' },
    {
      key: 'app.description',
      zh: '智能助手',
      en: 'Intelligent Assistant',
      ja: 'インテリジェントアシスタント',
      ko: '지능형 어시스턴트',
    },
    {
      key: 'app.greeting',
      zh: '欢迎使用 PY_APP！输入 /help 查看帮助。',
      en: 'Welcome to PY_APP! Type /help for assistance.',
      ja: 'PY_APPへようこそ！/help でヘルプを表示。',
      ko: 'PY_APP에 오신 것을 환영합니다! /help를 입력하여 도움말을 확인하세요.',
    },
    {
      key: 'app.goodbye',
      zh: '再见！',
      en: 'Goodbye!',
      ja: 'さようなら！',
      ko: '안녕히 계세요!',
    },
    {
      key: 'app.startup',
      zh: '正在启动 PY_APP...',
      en: 'Starting PY_APP...',
      ja: 'PY_APPを起動中...',
      ko: 'PY_APP 시작 중...',
    },
    {
      key: 'app.shutdown',
      zh: '正在关闭 PY_APP...',
      en: 'Shutting down PY_APP...',
      ja: 'PY_APPをシャットダウン中...',
      ko: 'PY_APP 종료 중...',
    },
    {
      key: 'app.uptime',
      zh: '运行时间: {uptime}',
      en: 'Uptime: {uptime}',
      ja: '稼働時間: {uptime}',
      ko: '가동 시간: {uptime}',
    },

    // ─── 命令 (command.*) ──────────────────────────────────────
    {
      key: 'command.help',
      zh: '显示帮助信息',
      en: 'Show help information',
      ja: 'ヘルプ情報を表示',
      ko: '도움말 정보 표시',
    },
    {
      key: 'command.exit',
      zh: '退出应用',
      en: 'Exit application',
      ja: 'アプリケーションを終了',
      ko: '애플리케이션 종료',
    },
    {
      key: 'command.version',
      zh: '显示版本信息',
      en: 'Show version information',
      ja: 'バージョン情報を表示',
      ko: '버전 정보 표시',
    },
    {
      key: 'command.config',
      zh: '配置管理',
      en: 'Configuration management',
      ja: '設定管理',
      ko: '구성 관리',
    },
    {
      key: 'command.plugin',
      zh: '插件管理',
      en: 'Plugin management',
      ja: 'プラグイン管理',
      ko: '플러그인 관리',
    },
    {
      key: 'command.session',
      zh: '会话管理',
      en: 'Session management',
      ja: 'セッション管理',
      ko: '세션 관리',
    },
    {
      key: 'command.diagnose',
      zh: '系统诊断',
      en: 'System diagnosis',
      ja: 'システム診断',
      ko: '시스템 진단',
    },
    {
      key: 'command.auth',
      zh: '认证管理',
      en: 'Authentication management',
      ja: '認証管理',
      ko: '인증 관리',
    },
    {
      key: 'command.market',
      zh: '插件市场',
      en: 'Plugin marketplace',
      ja: 'プラグインマーケット',
      ko: '플러그인 마켓',
    },
    {
      key: 'command.unknown',
      zh: '未知命令: {cmd}',
      en: 'Unknown command: {cmd}',
      ja: '不明なコマンド: {cmd}',
      ko: '알 수 없는 명령: {cmd}',
    },
    {
      key: 'command.invalid_args',
      zh: '命令参数无效',
      en: 'Invalid command arguments',
      ja: 'コマンド引数が無効です',
      ko: '명령 인수가 유효하지 않습니다',
    },
    {
      key: 'command.requires_subcommand',
      zh: '需要子命令',
      en: 'Requires subcommand',
      ja: 'サブコマンドが必要です',
      ko: '하위 명령이 필요합니다',
    },

    // ─── 工具 (tool.*) ──────────────────────────────────────────
    {
      key: 'tool.blocked',
      zh: '工具 "{tool}" 执行被阻止: {reason}',
      en: 'Tool "{tool}" execution blocked: {reason}',
      ja: 'ツール "{tool}" の実行がブロックされました: {reason}',
      ko: '도구 "{tool}" 실행 차단됨: {reason}',
    },
    {
      key: 'tool.confirm_required',
      zh: '工具 "{tool}" 需要确认: {reason}',
      en: 'Tool "{tool}" requires confirmation: {reason}',
      ja: 'ツール "{tool}" の確認が必要です: {reason}',
      ko: '도구 "{tool}" 확인 필요: {reason}',
    },
    {
      key: 'tool.not_found',
      zh: '工具未找到: {tool}',
      en: 'Tool not found: {tool}',
      ja: 'ツールが見つかりません: {tool}',
      ko: '도구를 찾을 수 없음: {tool}',
    },
    {
      key: 'tool.exec_failed',
      zh: '工具执行失败: {tool}',
      en: 'Tool execution failed: {tool}',
      ja: 'ツール実行失敗: {tool}',
      ko: '도구 실행 실패: {tool}',
    },
    {
      key: 'tool.timeout',
      zh: '工具 "{tool}" 执行超时 ({timeout}ms)',
      en: 'Tool "{tool}" timed out ({timeout}ms)',
      ja: 'ツール "{tool}" がタイムアウトしました ({timeout}ms)',
      ko: '도구 "{tool}" 시간 초과 ({timeout}ms)',
    },
    {
      key: 'tool.read_only',
      zh: '工具 "{tool}" 为只读，拒绝写入操作',
      en: 'Tool "{tool}" is read-only, write operation denied',
      ja: 'ツール "{tool}" は読み取り専用です。書き込み操作は拒否されました',
      ko: '도구 "{tool}"는 읽기 전용입니다. 쓰기 작업이 거부되었습니다',
    },
    {
      key: 'tool.destructive',
      zh: '工具 "{tool}" 是破坏性操作，需确认',
      en: 'Tool "{tool}" is destructive, confirmation required',
      ja: 'ツール "{tool}" は破壊的操作です。確認が必要です',
      ko: '도구 "{tool}"는 파괴적 작업입니다. 확인이 필요합니다',
    },
    {
      key: 'tool.invalid_input',
      zh: '工具 "{tool}" 输入参数无效: {detail}',
      en: 'Invalid input for tool "{tool}": {detail}',
      ja: 'ツール "{tool}" の入力が無効です: {detail}',
      ko: '도구 "{tool}" 입력이 유효하지 않음: {detail}',
    },
    {
      key: 'tool.exec_success',
      zh: '工具 "{tool}" 执行成功 ({duration}ms)',
      en: 'Tool "{tool}" executed successfully ({duration}ms)',
      ja: 'ツール "{tool}" が正常に実行されました ({duration}ms)',
      ko: '도구 "{tool}" 실행 성공 ({duration}ms)',
    },
    {
      key: 'tool.permission_denied',
      zh: '工具 "{tool}" 权限不足',
      en: 'Permission denied for tool "{tool}"',
      ja: 'ツール "{tool}" の権限が不足しています',
      ko: '도구 "{tool}"에 대한 권한이 거부되었습니다',
    },

    // ─── 网关/通道 (gateway.*) ────────────────────────────────
    {
      key: 'gateway.started',
      zh: '网关已启动 ({channels} 个通道)',
      en: 'Gateway started ({channels} channels)',
      ja: 'ゲートウェイを起動しました（{channels} チャンネル）',
      ko: '게이트웨이 시작됨 ({channels}개 채널)',
    },
    {
      key: 'gateway.stopped',
      zh: '网关已停止',
      en: 'Gateway stopped',
      ja: 'ゲートウェイを停止しました',
      ko: '게이트웨이 중지됨',
    },
    {
      key: 'gateway.error',
      zh: '网关错误: {error}',
      en: 'Gateway error: {error}',
      ja: 'ゲートウェイエラー: {error}',
      ko: '게이트웨이 오류: {error}',
    },
    {
      key: 'gateway.channel_connected',
      zh: '通道 "{channel}" 已连接',
      en: 'Channel "{channel}" connected',
      ja: 'チャンネル "{channel}" が接続されました',
      ko: '채널 "{channel}" 연결됨',
    },
    {
      key: 'gateway.channel_disconnected',
      zh: '通道 "{channel}" 已断开',
      en: 'Channel "{channel}" disconnected',
      ja: 'チャンネル "{channel}" が切断されました',
      ko: '채널 "{channel}" 연결 끊김',
    },
    {
      key: 'gateway.channel_error',
      zh: '通道 "{channel}" 错误: {error}',
      en: 'Channel "{channel}" error: {error}',
      ja: 'チャンネル "{channel}" エラー: {error}',
      ko: '채널 "{channel}" 오류: {error}',
    },
    {
      key: 'gateway.message_sent',
      zh: '消息已发送到 {channel}',
      en: 'Message sent to {channel}',
      ja: 'メッセージを {channel} に送信しました',
      ko: '{channel}에 메시지 전송됨',
    },
    {
      key: 'gateway.message_received',
      zh: '从 {channel} 收到消息',
      en: 'Message received from {channel}',
      ja: '{channel} からメッセージを受信しました',
      ko: '{channel}에서 메시지 수신됨',
    },

    // ─── 会话 (session.*) ────────────────────────────────────
    {
      key: 'session.created',
      zh: '会话已创建: {id}',
      en: 'Session created: {id}',
      ja: 'セッションを作成しました: {id}',
      ko: '세션 생성됨: {id}',
    },
    {
      key: 'session.resumed',
      zh: '会话已恢复: {id}',
      en: 'Session resumed: {id}',
      ja: 'セッションを再開しました: {id}',
      ko: '세션 재개됨: {id}',
    },
    {
      key: 'session.closed',
      zh: '会话已关闭: {id}',
      en: 'Session closed: {id}',
      ja: 'セッションを閉じました: {id}',
      ko: '세션 종료됨: {id}',
    },
    {
      key: 'session.not_found',
      zh: '会话未找到: {id}',
      en: 'Session not found: {id}',
      ja: 'セッションが見つかりません: {id}',
      ko: '세션을 찾을 수 없음: {id}',
    },
    {
      key: 'session.invalid',
      zh: '无效的会话 ID',
      en: 'Invalid session ID',
      ja: '無効なセッションID',
      ko: '유효하지 않은 세션 ID',
    },
    {
      key: 'session.list_empty',
      zh: '没有活动会话',
      en: 'No active sessions',
      ja: 'アクティブなセッションがありません',
      ko: '활성 세션이 없습니다',
    },
    {
      key: 'session.list_header',
      zh: '会话列表',
      en: 'Session List',
      ja: 'セッション一覧',
      ko: '세션 목록',
    },
    {
      key: 'session.list_footer',
      zh: '共 {count} 个会话',
      en: 'Total {count} sessions',
      ja: '合計 {count} セッション',
      ko: '총 {count}개 세션',
    },
    {
      key: 'session.list_error',
      zh: '获取会话列表失败: {detail}',
      en: 'Failed to fetch session list: {detail}',
      ja: 'セッション一覧の取得に失敗しました: {detail}',
      ko: '세션 목록을 가져오지 못했습니다: {detail}',
    },
    {
      key: 'session.detail_header',
      zh: '会话详情',
      en: 'Session Details',
      ja: 'セッション詳細',
      ko: '세션 상세',
    },
    {
      key: 'session.recent_messages',
      zh: '最近消息:',
      en: 'Recent messages:',
      ja: '最近のメッセージ:',
      ko: '최근 메시지:',
    },
    {
      key: 'session.no_messages',
      zh: '(无消息)',
      en: '(No messages)',
      ja: '(メッセージなし)',
      ko: '(메시지 없음)',
    },
    {
      key: 'session.no_content',
      zh: '(无内容)',
      en: '(No content)',
      ja: '(コンテンツなし)',
      ko: '(내용 없음)',
    },
    {
      key: 'session.inspect_usage',
      zh: '用法: session inspect <id>',
      en: 'Usage: session inspect <id>',
      ja: '使用方法: session inspect <id>',
      ko: '사용법: session inspect <id>',
    },
    {
      key: 'session.inspect_error',
      zh: '获取会话详情失败: {detail}',
      en: 'Failed to get session details: {detail}',
      ja: 'セッション詳細の取得に失敗しました: {detail}',
      ko: '세션 상세 정보를 가져오지 못했습니다: {detail}',
    },
    {
      key: 'session.export_usage',
      zh: '用法: session export <id> [--format json|md]',
      en: 'Usage: session export <id> [--format json|md]',
      ja: '使用方法: session export <id> [--format json|md]',
      ko: '사용법: session export <id> [--format json|md]',
    },
    {
      key: 'session.export_format_error',
      zh: '不支持的格式: {format}，可用格式: json, md',
      en: 'Unsupported format: {format}, available: json, md',
      ja: 'サポートされていない形式: {format}、利用可能: json, md',
      ko: '지원되지 않는 형식: {format}, 사용 가능: json, md',
    },
    {
      key: 'session.export_error',
      zh: '导出会话失败: {detail}',
      en: 'Failed to export session: {detail}',
      ja: 'セッションのエクスポートに失敗しました: {detail}',
      ko: '세션 내보내기에 실패했습니다: {detail}',
    },
    {
      key: 'session.help_description',
      zh: '管理会话',
      en: 'Manage sessions',
      ja: 'セッション管理',
      ko: '세션 관리',
    },
    {
      key: 'session.list',
      zh: '列出所有会话',
      en: 'List all sessions',
      ja: 'すべてのセッションを一覧表示',
      ko: '모든 세션 나열',
    },
    {
      key: 'session.inspect',
      zh: '查看会话详情',
      en: 'View session details',
      ja: 'セッション詳細を表示',
      ko: '세션 상세 보기',
    },
    {
      key: 'session.export',
      zh: '导出会话',
      en: 'Export session',
      ja: 'セッションをエクスポート',
      ko: '세션 내보내기',
    },
    {
      key: 'session.export_options',
      zh: '导出选项:',
      en: 'Export options:',
      ja: 'エクスポートオプション:',
      ko: '내보내기 옵션:',
    },

    // ─── 配置 (config.*) ──────────────────────────────────────
    {
      key: 'config.saved',
      zh: '配置已保存',
      en: 'Configuration saved',
      ja: '設定を保存しました',
      ko: '구성이 저장되었습니다',
    },
    {
      key: 'config.loaded',
      zh: '配置已加载',
      en: 'Configuration loaded',
      ja: '設定を読み込みました',
      ko: '구성이 로드되었습니다',
    },
    {
      key: 'config.invalid',
      zh: '配置无效: {detail}',
      en: 'Invalid configuration: {detail}',
      ja: '無効な設定: {detail}',
      ko: '유효하지 않은 구성: {detail}',
    },
    {
      key: 'config.not_found',
      zh: '配置键未找到: {key}',
      en: 'Configuration key not found: {key}',
      ja: '設定キーが見つかりません: {key}',
      ko: '구성 키를 찾을 수 없음: {key}',
    },
    {
      key: 'config.updated',
      zh: '配置 {key} 已更新为 {value}',
      en: 'Config {key} updated to {value}',
      ja: '設定 {key} が {value} に更新されました',
      ko: '구성 {key}이(가) {value}(으)로 업데이트됨',
    },
    {
      key: 'config.exported',
      zh: '配置已导出到 {path}',
      en: 'Configuration exported to {path}',
      ja: '設定を {path} にエクスポートしました',
      ko: '구성이 {path}에 내보내기되었습니다',
    },
    {
      key: 'config.get_usage',
      zh: '用法: config get <key>',
      en: 'Usage: config get <key>',
      ja: '使用方法: config get <key>',
      ko: '사용법: config get <key>',
    },
    {
      key: 'config.set_usage',
      zh: '用法: config set <key> <value>',
      en: 'Usage: config set <key> <value>',
      ja: '使用方法: config set <key> <value>',
      ko: '사용법: config set <key> <value>',
    },
    {
      key: 'config.update_failed',
      zh: '无法设置配置项: {key}，路径无效',
      en: 'Failed to set config: {key}, invalid path',
      ja: '設定の設定に失敗しました: {key}、無効なパス',
      ko: '구성 설정 실패: {key}, 유효하지 않은 경로',
    },
    {
      key: 'config.list_header',
      zh: '当前配置',
      en: 'Current Configuration',
      ja: '現在の設定',
      ko: '현재 구성',
    },
    {
      key: 'config.file_path',
      zh: '配置文件路径',
      en: 'Config file path',
      ja: '設定ファイルパス',
      ko: '구성 파일 경로',
    },
    {
      key: 'config.reset_all',
      zh: '配置已重置为默认值',
      en: 'Configuration reset to defaults',
      ja: '設定をデフォルトにリセットしました',
      ko: '구성이 기본값으로 재설정되었습니다',
    },
    {
      key: 'config.reset_key',
      zh: '已重置: {key}',
      en: 'Reset: {key}',
      ja: 'リセットしました: {key}',
      ko: '재설정됨: {key}',
    },
    {
      key: 'config.reset_failed',
      zh: '无法重置: {key}',
      en: 'Failed to reset: {key}',
      ja: 'リセットに失敗しました: {key}',
      ko: '재설정 실패: {key}',
    },
    {
      key: 'config.help_description',
      zh: '管理配置',
      en: 'Manage configuration',
      ja: '設定管理',
      ko: '구성 관리',
    },
    {
      key: 'config.get',
      zh: '获取配置项',
      en: 'Get configuration value',
      ja: '設定値を取得',
      ko: '구성 값 가져오기',
    },
    {
      key: 'config.set',
      zh: '设置配置项',
      en: 'Set configuration value',
      ja: '設定値を設定',
      ko: '구성 값 설정',
    },
    {
      key: 'config.list',
      zh: '列出所有配置',
      en: 'List all configuration',
      ja: 'すべての設定を一覧表示',
      ko: '모든 구성 나열',
    },
    {
      key: 'config.reset',
      zh: '重置配置',
      en: 'Reset configuration',
      ja: '設定をリセット',
      ko: '구성 재설정',
    },

    // ─── 插件 (plugin.*) ──────────────────────────────────────
    {
      key: 'plugin.installed',
      zh: '插件已安装: {name} v{version}',
      en: 'Plugin installed: {name} v{version}',
      ja: 'プラグインをインストールしました: {name} v{version}',
      ko: '플러그인 설치됨: {name} v{version}',
    },
    {
      key: 'plugin.uninstalled',
      zh: '插件已卸载: {name}',
      en: 'Plugin uninstalled: {name}',
      ja: 'プラグインをアンインストールしました: {name}',
      ko: '플러그인 제거됨: {name}',
    },
    {
      key: 'plugin.updated',
      zh: '插件已更新: {name} v{version}',
      en: 'Plugin updated: {name} v{version}',
      ja: 'プラグインを更新しました: {name} v{version}',
      ko: '플러그인 업데이트됨: {name} v{version}',
    },
    {
      key: 'plugin.not_found',
      zh: '插件未找到: {name}',
      en: 'Plugin not found: {name}',
      ja: 'プラグインが見つかりません: {name}',
      ko: '플러그인을 찾을 수 없음: {name}',
    },
    {
      key: 'plugin.load_failed',
      zh: '插件加载失败: {name} - {reason}',
      en: 'Plugin load failed: {name} - {reason}',
      ja: 'プラグインの読み込みに失敗しました: {name} - {reason}',
      ko: '플러그인 로드 실패: {name} - {reason}',
    },
    {
      key: 'plugin.sandbox_enabled',
      zh: '沙箱隔离已启用: {name}',
      en: 'Sandbox isolation enabled: {name}',
      ja: 'サンドボックス分離が有効です: {name}',
      ko: '샌드박스 격리 활성화됨: {name}',
    },
    {
      key: 'plugin.hot_reloaded',
      zh: '热替换完成: {name}',
      en: 'Hot reload complete: {name}',
      ja: 'ホットリロード完了: {name}',
      ko: '핫 리로드 완료: {name}',
    },
    {
      key: 'plugin.compatibility',
      zh: '插件兼容性检查: {name} - {status}',
      en: 'Plugin compatibility check: {name} - {status}',
      ja: 'プラグイン互換性チェック: {name} - {status}',
      ko: '플러그인 호환성 확인: {name} - {status}',
    },
    {
      key: 'plugin.dependency_missing',
      zh: '缺少依赖: {dep} (需要 {name} v{version})',
      en: 'Missing dependency: {dep} (required by {name} v{version})',
      ja: '依存関係が不足: {dep} ({name} v{version} が必要)',
      ko: '종속성 누락: {dep} ({name} v{version} 필요)',
    },

    // ─── 安全 (security.*) ──────────────────────────────────────
    {
      key: 'security.access_denied',
      zh: '访问被拒绝',
      en: 'Access Denied',
      ja: 'アクセス拒否',
      ko: '접근 거부됨',
    },
    {
      key: 'security.injection_detected',
      zh: '检测到注入攻击，操作已阻止',
      en: 'Injection attack detected, operation blocked',
      ja: 'インジェクション攻撃を検出、操作をブロックしました',
      ko: '인젝션 공격 감지, 작업 차단됨',
    },
    {
      key: 'security.permission_denied',
      zh: '权限不足: {resource}',
      en: 'Permission denied: {resource}',
      ja: '権限が不足しています: {resource}',
      ko: '권한 거부됨: {resource}',
    },
    {
      key: 'security.rate_limited',
      zh: '请求过于频繁，请 {seconds} 秒后再试',
      en: 'Rate limited, try again in {seconds} seconds',
      ja: 'レート制限中、{seconds} 秒後にお試しください',
      ko: '요청이 너무 많습니다. {seconds}초 후에 다시 시도하세요',
    },
    {
      key: 'security.unauthorized',
      zh: '未授权访问',
      en: 'Unauthorized access',
      ja: '不正アクセス',
      ko: '권한 없는 접근',
    },
    {
      key: 'security.suspicious_activity',
      zh: '检测到可疑活动: {detail}',
      en: 'Suspicious activity detected: {detail}',
      ja: '不審なアクティビティを検出: {detail}',
      ko: '의심스러운 활동 감지: {detail}',
    },

    // ─── 错误 (error.*) ──────────────────────────────────────────
    {
      key: 'error.unknown',
      zh: '未知错误',
      en: 'Unknown error',
      ja: '不明なエラー',
      ko: '알 수 없는 오류',
    },
    {
      key: 'error.config_not_found',
      zh: '配置文件未找到',
      en: 'Configuration file not found',
      ja: '設定ファイルが見つかりません',
      ko: '구성 파일을 찾을 수 없습니다',
    },
    {
      key: 'error.permission_denied',
      zh: '权限不足',
      en: 'Permission denied',
      ja: '権限が不足しています',
      ko: '권한이 거부되었습니다',
    },
    {
      key: 'error.network',
      zh: '网络错误: {detail}',
      en: 'Network error: {detail}',
      ja: 'ネットワークエラー: {detail}',
      ko: '네트워크 오류: {detail}',
    },
    {
      key: 'error.timeout',
      zh: '操作超时 ({timeout}ms)',
      en: 'Operation timed out ({timeout}ms)',
      ja: '操作がタイムアウトしました ({timeout}ms)',
      ko: '작업 시간 초과 ({timeout}ms)',
    },
    {
      key: 'error.internal',
      zh: '内部错误: {detail}',
      en: 'Internal error: {detail}',
      ja: '内部エラー: {detail}',
      ko: '내부 오류: {detail}',
    },
    {
      key: 'error.not_implemented',
      zh: '功能未实现: {feature}',
      en: 'Not implemented: {feature}',
      ja: '未実装: {feature}',
      ko: '구현되지 않음: {feature}',
    },
    {
      key: 'error.invalid_input',
      zh: '输入无效: {detail}',
      en: 'Invalid input: {detail}',
      ja: '無効な入力: {detail}',
      ko: '유효하지 않은 입력: {detail}',
    },
    {
      key: 'error.file_not_found',
      zh: '文件未找到: {path}',
      en: 'File not found: {path}',
      ja: 'ファイルが見つかりません: {path}',
      ko: '파일을 찾을 수 없음: {path}',
    },
    {
      key: 'error.file_read',
      zh: '文件读取失败: {path}',
      en: 'File read failed: {path}',
      ja: 'ファイルの読み取りに失敗しました: {path}',
      ko: '파일 읽기 실패: {path}',
    },
    {
      key: 'error.file_write',
      zh: '文件写入失败: {path}',
      en: 'File write failed: {path}',
      ja: 'ファイルの書き込みに失敗しました: {path}',
      ko: '파일 쓰기 실패: {path}',
    },

    // ─── 对话 (chat.*) ────────────────────────────────────────
    {
      key: 'chat.message_sent',
      zh: '消息已发送',
      en: 'Message sent',
      ja: 'メッセージを送信しました',
      ko: '메시지 전송됨',
    },
    {
      key: 'chat.message_received',
      zh: '收到回复 ({tokens} tokens, {duration}ms)',
      en: 'Response received ({tokens} tokens, {duration}ms)',
      ja: '応答を受信しました（{tokens} トークン、{duration}ms）',
      ko: '응답 수신됨 ({tokens} 토큰, {duration}ms)',
    },
    {
      key: 'chat.stream_start',
      zh: '开始流式响应...',
      en: 'Starting streaming response...',
      ja: 'ストリーミング応答を開始...',
      ko: '스트리밍 응답 시작...',
    },
    {
      key: 'chat.stream_end',
      zh: '流式响应结束',
      en: 'Streaming response ended',
      ja: 'ストリーミング応答が終了しました',
      ko: '스트리밍 응답 종료됨',
    },
    {
      key: 'chat.stream_error',
      zh: '流式响应错误: {error}',
      en: 'Streaming response error: {error}',
      ja: 'ストリーミング応答エラー: {error}',
      ko: '스트리밍 응답 오류: {error}',
    },
    {
      key: 'chat.context_limit',
      zh: '上下文长度已达上限 ({current}/{max} tokens)',
      en: 'Context length limit reached ({current}/{max} tokens)',
      ja: 'コンテキスト長の上限に達しました（{current}/{max} トークン）',
      ko: '컨텍스트 길이 제한 도달 ({current}/{max} 토큰)',
    },
    {
      key: 'chat.cost',
      zh: '本次对话成本: ${cost}',
      en: 'Conversation cost: ${cost}',
      ja: '会話コスト: ${cost}',
      ko: '대화 비용: ${cost}',
    },

    // ─── 记忆 (memory.*) ──────────────────────────────────────
    {
      key: 'memory.saved',
      zh: '记忆已保存',
      en: 'Memory saved',
      ja: '記憶を保存しました',
      ko: '기억 저장됨',
    },
    {
      key: 'memory.retrieved',
      zh: '找到 {count} 条相关记忆',
      en: 'Found {count} relevant memories',
      ja: '{count} 件の関連記憶を見つけました',
      ko: '{count}개의 관련 기억을 찾았습니다',
    },
    {
      key: 'memory.cleared',
      zh: '记忆已清除',
      en: 'Memory cleared',
      ja: '記憶を消去しました',
      ko: '기억 지워짐',
    },
    {
      key: 'memory.empty',
      zh: '没有找到相关记忆',
      en: 'No relevant memories found',
      ja: '関連する記憶が見つかりませんでした',
      ko: '관련 기억을 찾을 수 없습니다',
    },

    // ─── 成本 (cost.*) ──────────────────────────────────────────
    {
      key: 'cost.usage_summary',
      zh: '成本摘要: {cost} USD, {tokens} tokens',
      en: 'Cost Summary: {cost} USD, {tokens} tokens',
      ja: 'コストサマリー: {cost} USD, {tokens} トークン',
      ko: '비용 요약: {cost} USD, {tokens} 토큰',
    },
    {
      key: 'cost.daily_total',
      zh: '今日总成本: {cost} USD',
      en: 'Today total cost: {cost} USD',
      ja: '本日の総コスト: {cost} USD',
      ko: '오늘 총 비용: {cost} USD',
    },
    {
      key: 'cost.monthly_total',
      zh: '本月总成本: {cost} USD',
      en: 'Monthly total cost: {cost} USD',
      ja: '今月の総コスト: {cost} USD',
      ko: '이번 달 총 비용: {cost} USD',
    },
    {
      key: 'cost.budget_exceeded',
      zh: '预算超限: {cost} USD (限制: {limit} USD)',
      en: 'Budget exceeded: {cost} USD (limit: {limit} USD)',
      ja: '予算超過: {cost} USD（制限: {limit} USD）',
      ko: '예산 초과: {cost} USD (제한: {limit} USD)',
    },
    {
      key: 'cost.anomaly_detected',
      zh: '检测到成本异常: {detail}',
      en: 'Cost anomaly detected: {detail}',
      ja: 'コスト異常を検出: {detail}',
      ko: '비용 이상 감지: {detail}',
    },

    // ─── 监控 (monitor.*) ────────────────────────────────────
    {
      key: 'monitor.health_ok',
      zh: '系统健康',
      en: 'System healthy',
      ja: 'システムは正常です',
      ko: '시스템 상태 양호',
    },
    {
      key: 'monitor.health_warn',
      zh: '系统存在警告',
      en: 'System has warnings',
      ja: 'システムに警告があります',
      ko: '시스템에 경고가 있습니다',
    },
    {
      key: 'monitor.health_error',
      zh: '系统存在错误',
      en: 'System has errors',
      ja: 'システムにエラーがあります',
      ko: '시스템에 오류가 있습니다',
    },
    {
      key: 'monitor.memory_usage',
      zh: '内存使用: {used}MB / {total}MB',
      en: 'Memory usage: {used}MB / {total}MB',
      ja: 'メモリ使用量: {used}MB / {total}MB',
      ko: '메모리 사용량: {used}MB / {total}MB',
    },
    {
      key: 'monitor.cpu_usage',
      zh: 'CPU 使用率: {usage}%',
      en: 'CPU usage: {usage}%',
      ja: 'CPU使用率: {usage}%',
      ko: 'CPU 사용률: {usage}%',
    },
    {
      key: 'monitor.active_tools',
      zh: '活跃工具数: {count}',
      en: 'Active tools: {count}',
      ja: 'アクティブツール数: {count}',
      ko: '활성 도구 수: {count}',
    },
    {
      key: 'monitor.alert_triggered',
      zh: '告警触发: {name} - {message}',
      en: 'Alert triggered: {name} - {message}',
      ja: 'アラート発動: {name} - {message}',
      ko: '알림 트리거됨: {name} - {message}',
    },

    // ─── OAuth (oauth.*) ─────────────────────────────────────
    {
      key: 'oauth.login_success',
      zh: '登录成功: {provider}',
      en: 'Login successful: {provider}',
      ja: 'ログイン成功: {provider}',
      ko: '로그인 성공: {provider}',
    },
    {
      key: 'oauth.login_failed',
      zh: '登录失败: {provider} - {reason}',
      en: 'Login failed: {provider} - {reason}',
      ja: 'ログイン失敗: {provider} - {reason}',
      ko: '로그인 실패: {provider} - {reason}',
    },
    {
      key: 'oauth.logout',
      zh: '已登出: {provider}',
      en: 'Logged out: {provider}',
      ja: 'ログアウトしました: {provider}',
      ko: '로그아웃됨: {provider}',
    },
    {
      key: 'oauth.token_expired',
      zh: '令牌已过期，请重新登录',
      en: 'Token expired, please re-authenticate',
      ja: 'トークンの有効期限が切れました。再認証してください',
      ko: '토큰이 만료되었습니다. 다시 인증하세요',
    },
    {
      key: 'oauth.token_refreshed',
      zh: '令牌已刷新',
      en: 'Token refreshed',
      ja: 'トークンを更新しました',
      ko: '토큰이 갱신되었습니다',
    },

    // ─── AI/LLM (ai.*) ──────────────────────────────────────
    {
      key: 'ai.model_loading',
      zh: '正在加载模型 "{model}"...',
      en: 'Loading model "{model}"...',
      ja: 'モデル "{model}" を読み込み中...',
      ko: '모델 "{model}" 로딩 중...',
    },
    {
      key: 'ai.model_loaded',
      zh: '模型 "{model}" 已加载',
      en: 'Model "{model}" loaded',
      ja: 'モデル "{model}" を読み込みました',
      ko: '모델 "{model}" 로드됨',
    },
    {
      key: 'ai.query_start',
      zh: '正在查询 {model}...',
      en: 'Querying {model}...',
      ja: '{model} に問い合わせ中...',
      ko: '{model} 쿼리 중...',
    },
    {
      key: 'ai.query_done',
      zh: '查询完成 ({duration}ms, {tokens} tokens)',
      en: 'Query completed ({duration}ms, {tokens} tokens)',
      ja: '問い合わせ完了（{duration}ms、{tokens} トークン）',
      ko: '쿼리 완료 ({duration}ms, {tokens} 토큰)',
    },
    {
      key: 'ai.query_error',
      zh: '查询失败: {error}',
      en: 'Query failed: {error}',
      ja: '問い合わせ失敗: {error}',
      ko: '쿼리 실패: {error}',
    },
    {
      key: 'ai.tool_call',
      zh: 'AI 请求使用工具: {tool}',
      en: 'AI requested tool: {tool}',
      ja: 'AI がツールを要求: {tool}',
      ko: 'AI가 도구 요청: {tool}',
    },
    {
      key: 'ai.tool_result',
      zh: '工具 {tool} 返回结果 ({duration}ms)',
      en: 'Tool {tool} returned result ({duration}ms)',
      ja: 'ツール {tool} が結果を返しました（{duration}ms）',
      ko: '도구 {tool} 결과 반환 ({duration}ms)',
    },

    // ─── 提示/确认 (prompt.*) ──────────────────────────────
    {
      key: 'prompt.input',
      zh: '请输入',
      en: 'Please input',
      ja: '入力してください',
      ko: '입력하세요',
    },
    {
      key: 'prompt.confirm',
      zh: '确认',
      en: 'Confirm',
      ja: '確認',
      ko: '확인',
    },
    {
      key: 'prompt.cancel',
      zh: '取消',
      en: 'Cancel',
      ja: 'キャンセル',
      ko: '취소',
    },
    {
      key: 'prompt.choose',
      zh: '请选择',
      en: 'Please select',
      ja: '選択してください',
      ko: '선택하세요',
    },
    {
      key: 'prompt.continue',
      zh: '按 Enter 继续...',
      en: 'Press Enter to continue...',
      ja: 'Enterキーを押して続行...',
      ko: 'Enter를 눌러 계속...',
    },
    {
      key: 'prompt.yes_no',
      zh: '是/否',
      en: 'Yes/No',
      ja: 'はい/いいえ',
      ko: '예/아니오',
    },

    // ─── 成功消息 (success.*) ──────────────────────────────
    {
      key: 'success.saved',
      zh: '保存成功',
      en: 'Saved successfully',
      ja: '保存しました',
      ko: '저장 성공',
    },
    {
      key: 'success.loaded',
      zh: '加载成功',
      en: 'Loaded successfully',
      ja: '読み込みました',
      ko: '로드 성공',
    },
    {
      key: 'success.deleted',
      zh: '删除成功',
      en: 'Deleted successfully',
      ja: '削除しました',
      ko: '삭제 성공',
    },
    {
      key: 'success.updated',
      zh: '更新成功',
      en: 'Updated successfully',
      ja: '更新しました',
      ko: '업데이트 성공',
    },
    {
      key: 'success.created',
      zh: '创建成功',
      en: 'Created successfully',
      ja: '作成しました',
      ko: '생성 성공',
    },
    {
      key: 'success.exported',
      zh: '导出成功',
      en: 'Exported successfully',
      ja: 'エクスポートしました',
      ko: '내보내기 성공',
    },
    {
      key: 'success.imported',
      zh: '导入成功',
      en: 'Imported successfully',
      ja: 'インポートしました',
      ko: '가져오기 성공',
    },

    // ─── 文件操作 (file.*) ──────────────────────────────────
    {
      key: 'file.read',
      zh: '读取文件: {path}',
      en: 'Reading file: {path}',
      ja: 'ファイルを読み取り中: {path}',
      ko: '파일 읽는 중: {path}',
    },
    {
      key: 'file.write',
      zh: '写入文件: {path}',
      en: 'Writing file: {path}',
      ja: 'ファイルに書き込み中: {path}',
      ko: '파일 쓰는 중: {path}',
    },
    {
      key: 'file.delete',
      zh: '删除文件: {path}',
      en: 'Deleting file: {path}',
      ja: 'ファイルを削除中: {path}',
      ko: '파일 삭제 중: {path}',
    },
    {
      key: 'file.rename',
      zh: '重命名: {old} → {new}',
      en: 'Renaming: {old} → {new}',
      ja: '名前変更: {old} → {new}',
      ko: '이름 변경: {old} → {new}',
    },
    {
      key: 'file.copy',
      zh: '复制: {src} → {dst}',
      en: 'Copying: {src} → {dst}',
      ja: 'コピー: {src} → {dst}',
      ko: '복사: {src} → {dst}',
    },
    {
      key: 'file.search',
      zh: '搜索 "{pattern}" 在 {path}',
      en: 'Searching "{pattern}" in {path}',
      ja: '"{pattern}" を {path} で検索中',
      ko: '"{pattern}"을(를) {path}에서 검색 중',
    },
    {
      key: 'file.watch',
      zh: '监听文件变更: {path}',
      en: 'Watching file changes: {path}',
      ja: 'ファイル変更を監視中: {path}',
      ko: '파일 변경 감시 중: {path}',
    },

    // ─── Git (git.*) ──────────────────────────────────────────
    {
      key: 'git.branch_switch',
      zh: '切换到分支: {branch}',
      en: 'Switched to branch: {branch}',
      ja: 'ブランチを切り替え: {branch}',
      ko: '브랜치 전환: {branch}',
    },
    {
      key: 'git.branch_create',
      zh: '创建分支: {branch}',
      en: 'Created branch: {branch}',
      ja: 'ブランチを作成: {branch}',
      ko: '브랜치 생성: {branch}',
    },
    {
      key: 'git.branch_delete',
      zh: '删除分支: {branch}',
      en: 'Deleted branch: {branch}',
      ja: 'ブランチを削除: {branch}',
      ko: '브랜치 삭제: {branch}',
    },
    {
      key: 'git.merge',
      zh: '合并 {source} → {target}',
      en: 'Merged {source} → {target}',
      ja: '{source} を {target} にマージ',
      ko: '{source} → {target} 병합',
    },
    {
      key: 'git.stash_save',
      zh: '暂存变更',
      en: 'Stashed changes',
      ja: '変更を退避しました',
      ko: '변경 사항 스태시 저장',
    },
    {
      key: 'git.stash_pop',
      zh: '恢复暂存',
      en: 'Restored stashed changes',
      ja: '退避した変更を復元しました',
      ko: '스태시 복원됨',
    },
    {
      key: 'git.commit',
      zh: '提交: {message}',
      en: 'Committed: {message}',
      ja: 'コミット: {message}',
      ko: '커밋: {message}',
    },

    // ─── 主题 (theme.*) ──────────────────────────────────────
    {
      key: 'theme.switched',
      zh: '主题已切换为 "{theme}"',
      en: 'Theme switched to "{theme}"',
      ja: 'テーマを "{theme}" に切り替えました',
      ko: '테마가 "{theme}"(으)로 전환되었습니다',
    },
    {
      key: 'theme.invalid',
      zh: '无效的主题: {theme}',
      en: 'Invalid theme: {theme}',
      ja: '無効なテーマ: {theme}',
      ko: '유효하지 않은 테마: {theme}',
    },
    {
      key: 'theme.custom_loaded',
      zh: '自定义主题已加载: {path}',
      en: 'Custom theme loaded: {path}',
      ja: 'カスタムテーマを読み込みました: {path}',
      ko: '사용자 정의 테마 로드됨: {path}',
    },

    // ─── 诊断 (diagnose.*) ──────────────────────────────────
    {
      key: 'diagnose.running',
      zh: '正在运行系统诊断...',
      en: 'Running system diagnostics...',
      ja: 'システム診断を実行中...',
      ko: '시스템 진단 실행 중...',
    },
    {
      key: 'diagnose.done',
      zh: '诊断完成。发现 {errors} 个错误, {warnings} 个警告',
      en: 'Diagnostics complete. Found {errors} errors, {warnings} warnings',
      ja: '診断が完了しました。{errors} 件のエラー、{warnings} 件の警告',
      ko: '진단 완료. {errors}개 오류, {warnings}개 경고 발견',
    },
    {
      key: 'diagnose.module_status',
      zh: '{module}: {status}',
      en: '{module}: {status}',
      ja: '{module}: {status}',
      ko: '{module}: {status}',
    },

    // ─── 更新 (update.*) ──────────────────────────────────────
    {
      key: 'update.checking',
      zh: '正在检查更新...',
      en: 'Checking for updates...',
      ja: 'アップデートを確認中...',
      ko: '업데이트 확인 중...',
    },
    {
      key: 'update.available',
      zh: '发现新版本: {version} (当前: {current})',
      en: 'New version available: {version} (current: {current})',
      ja: '新しいバージョンがあります: {version}（現在: {current}）',
      ko: '새 버전 사용 가능: {version} (현재: {current})',
    },
    {
      key: 'update.up_to_date',
      zh: '已是最新版本',
      en: 'Already up to date',
      ja: '最新バージョンです',
      ko: '최신 버전입니다',
    },
    {
      key: 'update.downloading',
      zh: '正在下载更新 ({progress}%)...',
      en: 'Downloading update ({progress}%)...',
      ja: 'アップデートをダウンロード中（{progress}%）...',
      ko: '업데이트 다운로드 중 ({progress}%)...',
    },
    {
      key: 'update.installing',
      zh: '正在安装更新...',
      en: 'Installing update...',
      ja: 'アップデートをインストール中...',
      ko: '업데이트 설치 중...',
    },
    {
      key: 'update.done',
      zh: '更新完成',
      en: 'Update complete',
      ja: 'アップデートが完了しました',
      ko: '업데이트 완료',
    },
    {
      key: 'update.failed',
      zh: '更新失败: {reason}',
      en: 'Update failed: {reason}',
      ja: 'アップデートに失敗しました: {reason}',
      ko: '업데이트 실패: {reason}',
    },

    // ─── 备份 (backup.*) ──────────────────────────────────
    {
      key: 'backup.started',
      zh: '备份开始: {path}',
      en: 'Backup started: {path}',
      ja: 'バックアップを開始: {path}',
      ko: '백업 시작됨: {path}',
    },
    {
      key: 'backup.completed',
      zh: '备份完成: {path} ({size})',
      en: 'Backup completed: {path} ({size})',
      ja: 'バックアップ完了: {path}（{size}）',
      ko: '백업 완료: {path} ({size})',
    },
    {
      key: 'backup.failed',
      zh: '备份失败: {reason}',
      en: 'Backup failed: {reason}',
      ja: 'バックアップ失敗: {reason}',
      ko: '백업 실패: {reason}',
    },
    {
      key: 'backup.cleanup',
      zh: '清理旧备份: 保留 {keep} 个, 删除 {deleted} 个',
      en: 'Cleaned up old backups: kept {keep}, deleted {deleted}',
      ja: '古いバックアップを整理: {keep} 個保持、{deleted} 個削除',
      ko: '오래된 백업 정리: {keep}개 유지, {deleted}개 삭제',
    },

    // ─── 帮助 (help.*) ──────────────────────────────────────
    {
      key: 'help.welcome',
      zh: '欢迎使用 PY_APP 帮助系统',
      en: 'Welcome to PY_APP help system',
      ja: 'PY_APP ヘルプシステムへようこそ',
      ko: 'PY_APP 도움말 시스템에 오신 것을 환영합니다',
    },
    {
      key: 'help.commands_header',
      zh: '可用命令:',
      en: 'Available commands:',
      ja: '使用可能なコマンド:',
      ko: '사용 가능한 명령:',
    },
    {
      key: 'help.tools_header',
      zh: '可用工具:',
      en: 'Available tools:',
      ja: '使用可能なツール:',
      ko: '사용 가능한 도구:',
    },
    {
      key: 'help.search_results',
      zh: '搜索结果 ({count}):',
      en: 'Search results ({count}):',
      ja: '検索結果（{count}件）:',
      ko: '검색 결과 ({count}개):',
    },
    {
      key: 'help.no_results',
      zh: '未找到相关结果',
      en: 'No results found',
      ja: '結果が見つかりませんでした',
      ko: '결과를 찾을 수 없습니다',
    },
    {
      key: 'help.suggestion',
      zh: '提示: 输入 /help <命令> 查看特定命令的帮助',
      en: 'Tip: Type /help <command> for help on a specific command',
      ja: 'ヒント: /help <コマンド> で特定のコマンドのヘルプを表示',
      ko: '팁: /help <명령>을 입력하여 특정 명령에 대한 도움말 보기',
    },
  ];

  registry.registerBatch(entries);
}
