CREATE TABLE agenda_calendars (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'LOCAL' CHECK (source IN ('LOCAL','ICS','GOOGLE','MICROSOFT')),
  external_id TEXT,
  external_account TEXT,
  host TEXT,
  selected INTEGER NOT NULL DEFAULT 1,
  sync_token TEXT,
  sync_window_start TEXT,
  synced_at INTEGER,
  last_error TEXT
);
CREATE UNIQUE INDEX agenda_calendars_external ON agenda_calendars (source, external_id)
  WHERE deleted_at IS NULL AND external_id IS NOT NULL;

CREATE TABLE agenda_events (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  calendar_id TEXT NOT NULL REFERENCES agenda_calendars (id),
  title TEXT NOT NULL,
  notes TEXT,
  location TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  start_at INTEGER,
  end_at INTEGER,
  start_date TEXT,
  end_date TEXT,
  color TEXT,
  rrule TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','CANCELLED')),
  recurring_event_id TEXT,
  original_start TEXT,
  source TEXT NOT NULL DEFAULT 'LOCAL' CHECK (source IN ('LOCAL','ICS','GOOGLE','MICROSOFT')),
  external_id TEXT,
  external_etag TEXT,
  sync_state TEXT NOT NULL DEFAULT 'SYNCED' CHECK (sync_state IN ('SYNCED','PENDING','ERROR')),
  CONSTRAINT agenda_events_times CHECK (
    (all_day = 1 AND start_date IS NOT NULL AND end_date IS NOT NULL AND start_at IS NULL AND end_at IS NULL)
    OR (all_day = 0 AND start_at IS NOT NULL AND end_at IS NOT NULL AND start_date IS NULL AND end_date IS NULL)
  )
);
CREATE UNIQUE INDEX agenda_events_external ON agenda_events (calendar_id, external_id)
  WHERE deleted_at IS NULL AND external_id IS NOT NULL;
CREATE UNIQUE INDEX agenda_events_override ON agenda_events (recurring_event_id, original_start)
  WHERE deleted_at IS NULL AND recurring_event_id IS NOT NULL;
CREATE INDEX agenda_events_start_at ON agenda_events (start_at);
CREATE INDEX agenda_events_start_date ON agenda_events (start_date);
CREATE INDEX agenda_events_calendar ON agenda_events (calendar_id);
