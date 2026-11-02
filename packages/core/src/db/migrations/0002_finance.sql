CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`initial_balance_cents` integer DEFAULT 0 NOT NULL,
	`color` text,
	`closing_day` integer,
	`due_day` integer,
	`payment_account_id` text,
	`archived_at` integer,
	CONSTRAINT "accounts_type" CHECK("accounts"."type" IN ('WALLET','CHECKING','SAVINGS','CREDIT_CARD'))
);


CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`item_id` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`number` text,
	`type` text NOT NULL,
	`balance_cents` integer DEFAULT 0 NOT NULL,
	`account_id` text,
	`import_from` text,
	`synced_at` integer,
	FOREIGN KEY (`item_id`) REFERENCES `pluggy_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `bank_accounts_external` ON `bank_accounts` (`external_id`);
CREATE UNIQUE INDEX `bank_accounts_account` ON `bank_accounts` (`account_id`);
CREATE TABLE `bank_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`bank_account_id` text NOT NULL,
	`external_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`installment_number` integer,
	`installment_total` integer,
	`bill_due_date` text,
	`bill_closing_date` text,
	`status` text NOT NULL,
	`suggested_category_id` text,
	`suggestion_source` text,
	`transaction_id` text,
	`edited` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suggested_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE UNIQUE INDEX `bank_movements_external` ON `bank_movements` (`bank_account_id`,`external_id`);
CREATE INDEX `bank_movements_status` ON `bank_movements` (`status`);
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`limit_cents` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `budgets_category_month` ON `budgets` (`category_id`,`month`);
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`parent_id` text,
	`icon` text,
	`color` text,
	`system_key` text,
	`default_key` text,
	CONSTRAINT "categories_kind" CHECK("categories"."kind" IN ('INCOME','EXPENSE'))
);

CREATE UNIQUE INDEX `categories_system_key` ON `categories` (`kind`,`system_key`);
CREATE UNIQUE INDEX `categories_default_key` ON `categories` (`kind`,`default_key`);
CREATE TABLE `credit_card_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`account_id` text NOT NULL,
	`reference_month` text NOT NULL,
	`closing_date` text NOT NULL,
	`due_date` text NOT NULL,
	`paid_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `invoices_account_month` ON `credit_card_invoices` (`account_id`,`reference_month`);
CREATE TABLE `pluggy_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`item_id` text NOT NULL,
	`name` text NOT NULL,
	`image_url` text,
	`status` text,
	`last_error` text,
	`synced_at` integer
);

CREATE UNIQUE INDEX `pluggy_items_item` ON `pluggy_items` (`item_id`);
CREATE TABLE `recurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rrule` text NOT NULL,
	`start_date` text NOT NULL,
	`template` text NOT NULL,
	`generated_until` text NOT NULL
);

CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`date` text NOT NULL,
	`account_id` text NOT NULL,
	`to_account_id` text,
	`category_id` text,
	`description` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'DONE' NOT NULL,
	`recurrence_id` text,
	`is_recurrence_exception` integer DEFAULT false NOT NULL,
	`installment_group_id` text,
	`installment_number` integer,
	`installment_total` integer,
	`invoice_id` text,
	`pays_invoice_id` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recurrence_id`) REFERENCES `recurrences`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invoice_id`) REFERENCES `credit_card_invoices`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`pays_invoice_id`) REFERENCES `credit_card_invoices`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "transactions_kind" CHECK("transactions"."kind" IN ('INCOME','EXPENSE','TRANSFER')),
	CONSTRAINT "transactions_status" CHECK("transactions"."status" IN ('PLANNED','DONE')),
	CONSTRAINT "transactions_positive" CHECK("transactions"."amount_cents" > 0)
);

CREATE UNIQUE INDEX `transactions_pays_invoice` ON `transactions` (`pays_invoice_id`);
CREATE INDEX `transactions_date` ON `transactions` (`date`);
CREATE INDEX `transactions_account_date` ON `transactions` (`account_id`,`date`);