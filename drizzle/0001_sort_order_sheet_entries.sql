ALTER TABLE "sheet_entries" ADD COLUMN "sort_order" integer NOT NULL DEFAULT 0;

WITH ordered AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, month_key
      ORDER BY entry_date, start_time, created_at, id
    ) AS rn
  FROM sheet_entries
)
UPDATE sheet_entries
SET sort_order = ordered.rn
FROM ordered
WHERE sheet_entries.id = ordered.id;
