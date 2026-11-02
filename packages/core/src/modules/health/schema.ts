import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const base = {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
};

// Uma linha por dia: check-in, sono da noite que terminou nesse dia, água e diário.
export const healthDays = sqliteTable(
  'health_days',
  {
    ...base,
    date: text('date').notNull(),
    mood: integer('mood'),
    energy: integer('energy'),
    gratitude: text('gratitude'),
    bedTime: text('bed_time'),
    wakeTime: text('wake_time'),
    sleepQuality: integer('sleep_quality'),
    sleepMinutes: integer('sleep_minutes'),
    waterMl: integer('water_ml').notNull().default(0),
    diary: text('diary'),
  },
  (t) => [uniqueIndex('health_days_date').on(t.date).where(sql`deleted_at IS NULL`)]
);

export const healthMeds = sqliteTable('health_meds', {
  ...base,
  name: text('name').notNull(),
  kind: text('kind', { enum: ['MEDICINE', 'SUPPLEMENT'] }).notNull(),
  dose: text('dose').notNull(),
  schedule: text('schedule', { enum: ['DAILY', 'WEEKDAYS', 'INTERVAL', 'AS_NEEDED'] }).notNull(),
  weekdays: text('weekdays', { mode: 'json' }).notNull().$type<number[]>(),
  intervalDays: integer('interval_days'),
  times: text('times', { mode: 'json' }).notNull().$type<string[]>(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  // Mudar a regra de horários zera a conta: a aderência antiga media outra rotina.
  adherenceFrom: text('adherence_from').notNull(),
  notes: text('notes'),
});

// `date` é o dia da dose, não o da marcação. `time` nulo é uso "se precisar".
export const healthMedLogs = sqliteTable(
  'health_med_logs',
  {
    ...base,
    medId: text('med_id')
      .notNull()
      .references(() => healthMeds.id),
    date: text('date').notNull(),
    time: text('time'),
    takenAt: integer('taken_at').notNull(),
  },
  (t) => [
    uniqueIndex('health_med_logs_dose')
      .on(t.medId, t.date, t.time)
      .where(sql`deleted_at IS NULL AND time IS NOT NULL`),
    index('health_med_logs_med_date').on(t.medId, t.date),
  ]
);

export const healthAppointments = sqliteTable(
  'health_appointments',
  {
    ...base,
    kind: text('kind', { enum: ['CONSULTATION', 'EXAM'] }).notNull(),
    title: text('title').notNull(),
    date: text('date').notNull(),
    time: text('time'),
    location: text('location'),
    notes: text('notes'),
    returnDate: text('return_date'),
    doneAt: integer('done_at'),
  },
  (t) => [index('health_appointments_date').on(t.date)]
);

// O que já foi avisado, para o job de minuto em minuto não repetir.
export const healthNotices = sqliteTable(
  'health_notices',
  { ...base, key: text('key').notNull() },
  (t) => [uniqueIndex('health_notices_key').on(t.key).where(sql`deleted_at IS NULL`)]
);
