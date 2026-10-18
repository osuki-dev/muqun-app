-- Hot Updater 1.0.0 plugin schema; generated from the committed plugin definition.
CREATE TABLE IF NOT EXISTS "localized_release_notes_notes" ("release_id" TEXT NOT NULL, "locale" TEXT NOT NULL, "markdown" TEXT NOT NULL, "_v" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("release_id", "locale"));

INSERT INTO "private_hot_updater_settings" ("key", "value", "_v") VALUES ('schema.localized_release_notes', '1', 0) ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value";
