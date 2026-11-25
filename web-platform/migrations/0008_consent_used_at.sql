-- M7.1: distinguish a spent (single-use) consent from a denied consent.
-- Additive; existing rows retain NULL used_at and remain valid.
ALTER TABLE provider_consents ADD COLUMN used_at TEXT;
