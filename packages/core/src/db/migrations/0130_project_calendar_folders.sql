-- O projeto pode mostrar um calendário inteiro da Agenda, além dos eventos ligados a ele.
ALTER TABLE projects ADD COLUMN calendar_id TEXT REFERENCES agenda_calendars (id);

CREATE TABLE project_note_folders (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  project_id TEXT NOT NULL REFERENCES projects (id),
  name TEXT NOT NULL
);
CREATE INDEX project_note_folders_project ON project_note_folders (project_id);

ALTER TABLE project_notes ADD COLUMN folder_id TEXT REFERENCES project_note_folders (id);
CREATE INDEX project_notes_folder ON project_notes (folder_id);
