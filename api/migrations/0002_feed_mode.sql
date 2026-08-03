-- Mode is a product-surface fact (rail | bus | bike), distinct from adapter
-- (a parsing strategy) — /v1/nearby membership reads it. Curated seeds set
-- real values; catalog rows stay NULL and never surface through the
-- curated allowlist. Additive: old code tolerates the extra column, so
-- rollback of this migration is code-revert, not schema-revert.
ALTER TABLE feeds ADD COLUMN mode TEXT;
