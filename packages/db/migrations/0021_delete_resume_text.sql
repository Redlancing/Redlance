-- Resume text and uploaded files are deleted as soon as an import job ends (done or failed).
-- New jobs clear them in code; this removes what older finished jobs still hold. Safe to re-run.
UPDATE "import_jobs" SET "source_text" = NULL, "file_bytes" = NULL
WHERE "status" IN ('done', 'failed') AND ("source_text" IS NOT NULL OR "file_bytes" IS NOT NULL);
