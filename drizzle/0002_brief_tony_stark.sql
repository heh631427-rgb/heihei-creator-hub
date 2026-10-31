CREATE TABLE `auth_account_config` (
	`id` text PRIMARY KEY NOT NULL,
	`initialized_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`salt` text NOT NULL,
	`hash` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_accounts_username_unique` ON `auth_accounts` (`username`);