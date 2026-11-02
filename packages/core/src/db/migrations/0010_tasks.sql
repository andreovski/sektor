CREATE TABLE `task_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_inbox` integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX `task_lists_inbox` ON `task_lists` (`is_inbox`) WHERE `is_inbox` = 1 AND `deleted_at` IS NULL;

CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`type` text DEFAULT 'PERSONAL' NOT NULL,
	`description` text,
	`color` text,
	`due_date` text,
	`completed_at` integer,
	CONSTRAINT "projects_type" CHECK("projects"."type" IN ('PERSONAL','ACADEMIC','PROFESSIONAL','FREELANCE'))
);
CREATE INDEX `projects_completed` ON `projects` (`completed_at`);

CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`list_id` text NOT NULL REFERENCES `task_lists`(`id`),
	`project_id` text REFERENCES `projects`(`id`),
	`parent_task_id` text REFERENCES `tasks`(`id`),
	`title` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'TODO' NOT NULL,
	`priority` text,
	`due_date` text,
	`due_time` text,
	`rrule` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	CONSTRAINT "tasks_status" CHECK("tasks"."status" IN ('BACKLOG','TODO','IN_PROGRESS','REVIEW','DONE')),
	CONSTRAINT "tasks_priority" CHECK("tasks"."priority" IS NULL OR "tasks"."priority" IN ('LOW','MEDIUM','HIGH')),
	CONSTRAINT "tasks_time_needs_date" CHECK("tasks"."due_time" IS NULL OR "tasks"."due_date" IS NOT NULL),
	CONSTRAINT "tasks_done_is_completed" CHECK(("tasks"."status" = 'DONE') = ("tasks"."completed_at" IS NOT NULL))
);
CREATE INDEX `tasks_list` ON `tasks` (`list_id`, `parent_task_id`, `sort_order`);
CREATE INDEX `tasks_project` ON `tasks` (`project_id`);
CREATE INDEX `tasks_parent` ON `tasks` (`parent_task_id`);
CREATE INDEX `tasks_due` ON `tasks` (`due_date`);
CREATE INDEX `tasks_completed` ON `tasks` (`completed_at`);

CREATE TABLE `task_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL
);
CREATE UNIQUE INDEX `task_tags_name` ON `task_tags` (`name`) WHERE `deleted_at` IS NULL;

CREATE TABLE `task_tag_links` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`task_id` text NOT NULL REFERENCES `tasks`(`id`),
	`tag_id` text NOT NULL REFERENCES `task_tags`(`id`)
);
CREATE UNIQUE INDEX `task_tag_links_pair` ON `task_tag_links` (`task_id`, `tag_id`) WHERE `deleted_at` IS NULL;
CREATE INDEX `task_tag_links_tag` ON `task_tag_links` (`tag_id`);
