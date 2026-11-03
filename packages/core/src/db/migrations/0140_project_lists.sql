-- Projeto e lista viram uma coisa só: todo projeto tem uma lista, e a tarefa segue a lista.
-- O projeto aponta para a lista nova antes de ela existir; a chave é conferida no fim.
PRAGMA defer_foreign_keys = ON;
ALTER TABLE projects ADD COLUMN list_id TEXT REFERENCES task_lists (id);

-- Lista que já tem o nome do projeto vira a dele (só o primeiro projeto com aquele nome).
UPDATE projects SET list_id = (
  SELECT l.id FROM task_lists l
  WHERE l.deleted_at IS NULL AND l.is_inbox = 0 AND lower(l.name) = lower(projects.name)
  ORDER BY l.sort_order, l.created_at
  LIMIT 1
)
WHERE deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM projects p2
    WHERE p2.deleted_at IS NULL AND lower(p2.name) = lower(projects.name) AND p2.id < projects.id
  );

-- Os outros ganham uma lista nova, com o nome e a cor do projeto.
-- Um UUID por linha (as funções rodam a cada linha; subconsulta sem correlação rodaria uma vez só).
UPDATE projects SET list_id =
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-7' ||
  substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
WHERE deleted_at IS NULL AND list_id IS NULL;

INSERT INTO task_lists (id, created_at, updated_at, name, color, sort_order, is_inbox)
SELECT
  p.list_id,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  p.name,
  p.color,
  (SELECT coalesce(max(sort_order), -1) FROM task_lists WHERE deleted_at IS NULL)
    + row_number() OVER (ORDER BY p.created_at),
  0
FROM projects p
WHERE p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM task_lists l WHERE l.id = p.list_id);

CREATE UNIQUE INDEX projects_list ON projects (list_id)
  WHERE list_id IS NOT NULL AND deleted_at IS NULL;

-- As tarefas do projeto vão para a lista dele.
UPDATE tasks SET
  list_id = (SELECT p.list_id FROM projects p WHERE p.id = tasks.project_id),
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  sync_state = 'PENDING'
WHERE deleted_at IS NULL
  AND project_id IN (SELECT id FROM projects WHERE deleted_at IS NULL)
  AND list_id <> (SELECT p.list_id FROM projects p WHERE p.id = tasks.project_id);

-- E o que já estava na lista do projeto passa a ser dele.
UPDATE tasks SET
  project_id = (
    SELECT p.id FROM projects p WHERE p.list_id = tasks.list_id AND p.deleted_at IS NULL
  ),
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE deleted_at IS NULL
  AND list_id IN (SELECT list_id FROM projects WHERE deleted_at IS NULL AND list_id IS NOT NULL)
  AND project_id IS NOT (
    SELECT p.id FROM projects p WHERE p.list_id = tasks.list_id AND p.deleted_at IS NULL
  );
