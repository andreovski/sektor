CREATE TABLE `focus_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`mode` text NOT NULL,
	`day` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`planned_seconds` integer,
	`paused_at` integer,
	`paused_until` integer,
	`paused_ms` integer DEFAULT 0 NOT NULL,
	`focus_seconds` integer,
	`planned_notified_at` integer,
	`task_id` text,
	`project_id` text,
	`note` text,
	CONSTRAINT "focus_sessions_mode" CHECK(`mode` IN ('POMODORO','DEEP_WORK','FREE'))
);

CREATE INDEX `focus_sessions_day` ON `focus_sessions` (`day`);
-- Uma sessão aberta por vez: a expressão é sempre 1 dentro do filtro.
CREATE UNIQUE INDEX `focus_sessions_one_open` ON `focus_sessions` ((`ended_at` IS NULL))
	WHERE `ended_at` IS NULL AND `deleted_at` IS NULL;
