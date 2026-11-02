CREATE TABLE `habits` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`kind` text DEFAULT 'CONTINUOUS' NOT NULL,
	`frequency` text DEFAULT 'DAILY' NOT NULL,
	`times_per_week` integer,
	`start_on` text NOT NULL,
	`end_on` text,
	`color` text DEFAULT 'green' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "habits_kind" CHECK(`kind` IN ('CONTINUOUS','CHALLENGE')),
	CONSTRAINT "habits_frequency" CHECK(`frequency` IN ('DAILY','WEEKDAYS','TIMES')),
	CONSTRAINT "habits_times" CHECK(`frequency` <> 'TIMES' OR `times_per_week` BETWEEN 1 AND 6),
	CONSTRAINT "habits_challenge_end" CHECK(`kind` <> 'CHALLENGE' OR `end_on` IS NOT NULL)
);

CREATE INDEX `habits_position` ON `habits` (`position`);

CREATE TABLE `habit_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`habit_id` text NOT NULL,
	`date` text NOT NULL,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `habit_checks_day` ON `habit_checks` (`habit_id`,`date`) WHERE `deleted_at` IS NULL;
