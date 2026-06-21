export const SCHEMA = `
CREATE TABLE IF NOT EXISTS task_states (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  description TEXT NOT NULL DEFAULT '',
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  tool_use_count INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER NOT NULL DEFAULT 0,
  output_file TEXT NOT NULL DEFAULT '',
  output_offset INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  metadata TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  detail TEXT,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_delivery (
  task_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  channel TEXT,
  deliver_at INTEGER,
  delivered_at INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  notify_policy TEXT NOT NULL DEFAULT 'done_only'
);

CREATE TABLE IF NOT EXISTS task_flow (
  flow_id TEXT PRIMARY KEY,
  sync_mode TEXT NOT NULL DEFAULT 'task_mirrored',
  owner_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  goal TEXT NOT NULL DEFAULT '',
  current_step TEXT,
  blocked_task_id TEXT,
  state_json TEXT,
  wait_json TEXT,
  cancel_requested_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_task_states_status ON task_states(status);
CREATE INDEX IF NOT EXISTS idx_task_states_type ON task_states(type);
CREATE INDEX IF NOT EXISTS idx_task_states_updated ON task_states(updated_at);
CREATE INDEX IF NOT EXISTS idx_task_audit_task_id ON task_audit_log(task_id);
CREATE INDEX IF NOT EXISTS idx_task_audit_timestamp ON task_audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_task_flow_status ON task_flow(status);
CREATE INDEX IF NOT EXISTS idx_task_flow_owner ON task_flow(owner_key);

-- Phase 2: 工作项表
CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'task',
  status TEXT NOT NULL DEFAULT 'pending',
  session_id TEXT,
  tags TEXT,
  priority INTEGER DEFAULT 3,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_work_items_workspace ON work_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_updated ON work_items(updated_at);

-- task_runs: 跟踪每个任务的执行历史记录
CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at INTEGER,
  completed_at INTEGER,
  output TEXT,
  error TEXT,
  FOREIGN KEY (task_id) REFERENCES task_states(id)
);

CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);
`;

export const TABLE_NAMES = {
  TASK_STATES: 'task_states',
  TASK_AUDIT_LOG: 'task_audit_log',
  TASK_DELIVERY: 'task_delivery',
  TASK_FLOW: 'task_flow',
  TASK_RUNS: 'task_runs',
};

// FTS5 schema (单独导出，允许运行时降级)
export const FTS5_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS task_states_fts USING fts5(
  description, error, metadata,
  tokenize='porter unicode61'
);
`;

export const KANBAN_SCHEMA = `
CREATE TABLE IF NOT EXISTS kanban_cards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  column_id TEXT NOT NULL DEFAULT 'todo',
  assignee TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  tags TEXT,
  parent_task_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT,
  FOREIGN KEY (parent_task_id) REFERENCES task_states(id)
);

CREATE INDEX IF NOT EXISTS idx_kanban_column ON kanban_cards(column_id);
CREATE INDEX IF NOT EXISTS idx_kanban_assignee ON kanban_cards(assignee);
`;
