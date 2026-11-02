CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`title` text NOT NULL,
	`area` text NOT NULL,
	`target` real NOT NULL,
	`unit` text NOT NULL,
	`deadline` text,
	`started_on` text NOT NULL,
	`color` text DEFAULT 'green' NOT NULL,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`source_id` text,
	`manual_value` real DEFAULT 0 NOT NULL,
	CONSTRAINT "goals_area" CHECK(`area` IN ('SAUDE','FINANCAS','CARREIRA','ESTUDOS','RELACIONAMENTOS','PESSOAL')),
	CONSTRAINT "goals_source" CHECK(`source` IN ('MANUAL','PROJECT_TASKS','HABIT_STREAK','ACCOUNT_BALANCE')),
	CONSTRAINT "goals_linked" CHECK(`source` = 'MANUAL' OR `source_id` IS NOT NULL)
);

CREATE INDEX `goals_deadline` ON `goals` (`deadline`);
