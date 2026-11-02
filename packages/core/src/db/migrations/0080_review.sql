CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`week_start` text NOT NULL,
	`went_well` text DEFAULT '' NOT NULL,
	`blocked` text DEFAULT '' NOT NULL,
	`priorities` text DEFAULT '[]' NOT NULL
);

CREATE UNIQUE INDEX `reviews_week` ON `reviews` (`week_start`) WHERE `deleted_at` IS NULL;
