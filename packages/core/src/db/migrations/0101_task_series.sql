ALTER TABLE tasks ADD COLUMN rrule_anchor TEXT;
ALTER TABLE tasks ADD COLUMN next_task_id TEXT;
CREATE INDEX tasks_next ON tasks (next_task_id);
