CREATE TABLE health_days (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  date TEXT NOT NULL,
  mood INTEGER CHECK (mood BETWEEN 1 AND 5),
  energy INTEGER CHECK (energy BETWEEN 1 AND 5),
  gratitude TEXT,
  bed_time TEXT,
  wake_time TEXT,
  sleep_quality INTEGER CHECK (sleep_quality BETWEEN 1 AND 5),
  sleep_minutes INTEGER,
  water_ml INTEGER NOT NULL DEFAULT 0,
  diary TEXT
);
CREATE UNIQUE INDEX health_days_date ON health_days (date) WHERE deleted_at IS NULL;

CREATE TABLE health_meds (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('MEDICINE','SUPPLEMENT')),
  dose TEXT NOT NULL,
  schedule TEXT NOT NULL CHECK (schedule IN ('DAILY','WEEKDAYS','INTERVAL','AS_NEEDED')),
  weekdays TEXT NOT NULL DEFAULT '[]',
  interval_days INTEGER,
  times TEXT NOT NULL DEFAULT '[]',
  start_date TEXT NOT NULL,
  end_date TEXT,
  adherence_from TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE health_med_logs (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  med_id TEXT NOT NULL REFERENCES health_meds (id),
  date TEXT NOT NULL,
  time TEXT,
  taken_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX health_med_logs_dose ON health_med_logs (med_id, date, time)
  WHERE deleted_at IS NULL AND time IS NOT NULL;
CREATE INDEX health_med_logs_med_date ON health_med_logs (med_id, date);

CREATE TABLE health_appointments (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('CONSULTATION','EXAM')),
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT,
  location TEXT,
  notes TEXT,
  return_date TEXT,
  done_at INTEGER
);
CREATE INDEX health_appointments_date ON health_appointments (date);

CREATE TABLE health_notices (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  key TEXT NOT NULL
);
CREATE UNIQUE INDEX health_notices_key ON health_notices (key) WHERE deleted_at IS NULL;
