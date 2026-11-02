CREATE TABLE reminders (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('EVENT','TASK','CUSTOM')),
  owner_id TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  minutes_before INTEGER NOT NULL DEFAULT 0,
  schedule TEXT CHECK (schedule IN ('ONCE','INTERVAL','DAILY','WEEKDAYS','WEEKLY','MONTHLY')),
  start_date TEXT,
  time TEXT,
  interval_hours INTEGER,
  window_start TEXT,
  window_end TEXT,
  task_due_date TEXT,
  task_due_time TEXT,
  last_fired_for INTEGER,
  next_fire_at INTEGER,
  paused_at INTEGER
);
CREATE UNIQUE INDEX reminders_owner ON reminders (kind, owner_id, minutes_before)
  WHERE deleted_at IS NULL AND owner_id IS NOT NULL;
CREATE INDEX reminders_next_fire ON reminders (next_fire_at);
