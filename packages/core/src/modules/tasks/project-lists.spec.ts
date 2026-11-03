import Database from 'better-sqlite3-multiple-ciphers';
import { describe, expect, it } from 'vitest';

// A migração 0140 roda sobre um banco de antes dela, com projetos e tarefas espalhados.
const files = import.meta.glob<string>('../../db/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const version = (name: string) => Number(/(\d+)_[^/]+\.sql$/.exec(name)?.[1]);
const upTo = (max: number, min = 0) =>
  Object.keys(files)
    .sort()
    .filter((name) => version(name) > min && version(name) <= max)
    .map((name) => files[name]!);

describe('migração: projeto ganha lista', () => {
  it('reaproveita a lista de mesmo nome, cria as outras e leva as tarefas', () => {
    const db = new Database(':memory:');
    for (const sql of upTo(130)) db.exec(sql);
    const row = (table: string, values: Record<string, unknown>) => {
      const keys = Object.keys(values);
      db.prepare(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
      ).run(...Object.values(values));
    };
    const base = (id: string) => ({ id, created_at: 1, updated_at: 1 });
    row('task_lists', { ...base('inbox'), name: 'Entrada', is_inbox: 1 });
    row('task_lists', { ...base('l-yuni'), name: 'Yuni', sort_order: 3 });
    row('projects', { ...base('p-yuni'), name: 'yuni', color: 'blue' });
    row('projects', { ...base('p-site'), name: 'Site', color: 'green' });
    row('projects', { ...base('p-tcc'), name: 'TCC' });
    row('projects', { ...base('p-old'), name: 'Velho', deleted_at: 5 });
    row('tasks', { ...base('t1'), list_id: 'inbox', project_id: 'p-site', title: 'do site' });
    row('tasks', { ...base('t2'), list_id: 'inbox', project_id: 'p-site', parent_task_id: 't1', title: 'sub' });
    row('tasks', { ...base('t3'), list_id: 'l-yuni', title: 'já na Yuni' });
    row('tasks', { ...base('t4'), list_id: 'inbox', title: 'solta' });
    row('tasks', { ...base('t5'), list_id: 'inbox', project_id: 'p-tcc', title: 'tcc' });

    // Como `migrate`: cada arquivo numa transação.
    for (const sql of upTo(140, 130)) db.transaction(() => db.exec(sql))();

    const projects = db
      .prepare('SELECT id, list_id FROM projects ORDER BY id')
      .all() as { id: string; list_id: string | null }[];
    const listOf = Object.fromEntries(projects.map((p) => [p.id, p.list_id]));
    expect(listOf['p-yuni']).toBe('l-yuni');
    expect(listOf['p-old']).toBeNull();
    expect(listOf['p-site']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(listOf['p-site']).not.toBe(listOf['p-tcc']);

    const lists = db
      .prepare('SELECT id, name, color, sort_order FROM task_lists WHERE id IN (?, ?) ORDER BY sort_order')
      .all(listOf['p-site'], listOf['p-tcc']);
    expect(lists).toEqual([
      { id: listOf['p-site'], name: 'Site', color: 'green', sort_order: 4 },
      { id: listOf['p-tcc'], name: 'TCC', color: null, sort_order: 5 },
    ]);

    const tasks = Object.fromEntries(
      (db.prepare('SELECT id, list_id, project_id FROM tasks').all() as {
        id: string;
        list_id: string;
        project_id: string | null;
      }[]).map((t) => [t.id, [t.list_id, t.project_id]])
    );
    expect(tasks).toEqual({
      t1: [listOf['p-site'], 'p-site'],
      t2: [listOf['p-site'], 'p-site'],
      t3: ['l-yuni', 'p-yuni'],
      t4: ['inbox', null],
      t5: [listOf['p-tcc'], 'p-tcc'],
    });
    db.close();
  });
});
