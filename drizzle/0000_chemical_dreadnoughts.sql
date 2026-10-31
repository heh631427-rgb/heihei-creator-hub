CREATE TABLE `workbench_chunks` (
	`snapshot_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `chunk_index`)
);
--> statement-breakpoint
CREATE TABLE `workbench_history` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`counts` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workbench_meta` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`current_snapshot` text DEFAULT '' NOT NULL,
	`previous_snapshot` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
