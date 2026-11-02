ALTER TABLE projects ADD COLUMN start_date TEXT;
ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK (status IN ('ACTIVE','PAUSED','DONE'));
UPDATE projects SET status = 'DONE' WHERE completed_at IS NOT NULL;

ALTER TABLE agenda_events ADD COLUMN project_id TEXT REFERENCES projects (id);
CREATE INDEX agenda_events_project ON agenda_events (project_id);

CREATE TABLE project_notes (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  project_id TEXT NOT NULL REFERENCES projects (id),
  body TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX project_notes_project ON project_notes (project_id);

CREATE TABLE project_files (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  project_id TEXT NOT NULL REFERENCES projects (id),
  name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  stored_name TEXT NOT NULL
);
CREATE INDEX project_files_project ON project_files (project_id);
CREATE INDEX project_files_stored ON project_files (stored_name);
CREATE UNIQUE INDEX project_files_content ON project_files (project_id, content_hash)
  WHERE deleted_at IS NULL;
