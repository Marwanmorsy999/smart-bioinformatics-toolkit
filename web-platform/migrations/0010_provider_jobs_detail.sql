-- M7.2 continuation: status/artifact endpoints persist normalized detail.
-- Additive; existing rows keep NULL.
ALTER TABLE provider_jobs ADD COLUMN detail_json TEXT;
