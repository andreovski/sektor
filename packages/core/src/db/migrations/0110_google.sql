CREATE TABLE google_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  sub TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  scope TEXT NOT NULL DEFAULT '',
  sync_tasks INTEGER NOT NULL DEFAULT 0,
  tasks_synced_at INTEGER,
  last_sync_at INTEGER,
  needs_reconnect INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE UNIQUE INDEX google_accounts_sub ON google_accounts (sub) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX google_accounts_tasks ON google_accounts (sync_tasks)
  WHERE sync_tasks = 1 AND deleted_at IS NULL;

-- O mesmo calendário compartilhado pode vir por duas contas.
DROP INDEX agenda_calendars_external;
CREATE UNIQUE INDEX agenda_calendars_external ON agenda_calendars (source, external_account, external_id)
  WHERE deleted_at IS NULL AND external_id IS NOT NULL;
ALTER TABLE agenda_calendars ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agenda_calendars ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;

ALTER TABLE agenda_events ADD COLUMN time_zone TEXT;
ALTER TABLE agenda_events ADD COLUMN recurrence_extra TEXT;
CREATE INDEX agenda_events_sync ON agenda_events (sync_state) WHERE sync_state <> 'SYNCED';

-- PENDING é o padrão: o que existe aqui sobe na primeira sincronização de uma conta.
ALTER TABLE task_lists ADD COLUMN source TEXT NOT NULL DEFAULT 'LOCAL' CHECK (source IN ('LOCAL','GOOGLE'));
ALTER TABLE task_lists ADD COLUMN external_id TEXT;
ALTER TABLE task_lists ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (sync_state IN ('SYNCED','PENDING','ERROR'));
CREATE UNIQUE INDEX task_lists_external ON task_lists (external_id)
  WHERE deleted_at IS NULL AND external_id IS NOT NULL;

ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'LOCAL' CHECK (source IN ('LOCAL','GOOGLE'));
ALTER TABLE tasks ADD COLUMN external_id TEXT;
ALTER TABLE tasks ADD COLUMN external_etag TEXT;
ALTER TABLE tasks ADD COLUMN external_list_id TEXT;
ALTER TABLE tasks ADD COLUMN external_parent_id TEXT;
ALTER TABLE tasks ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (sync_state IN ('SYNCED','PENDING','ERROR'));
CREATE UNIQUE INDEX tasks_external ON tasks (external_id)
  WHERE deleted_at IS NULL AND external_id IS NOT NULL;
CREATE INDEX tasks_sync ON tasks (sync_state) WHERE sync_state <> 'SYNCED';
