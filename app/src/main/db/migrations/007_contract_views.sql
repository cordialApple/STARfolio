DROP VIEW IF EXISTS v_experiences;
CREATE VIEW v_experiences AS
  SELECT id, title, situation, task, action, result_text,
         context, status, happened_start, happened_end, created_at, updated_at
  FROM experiences;

DROP VIEW IF EXISTS v_experience_skills;
CREATE VIEW v_experience_skills AS
  SELECT es.experience_id, s.name AS skill_name, s.kind AS skill_kind
  FROM experience_skills es JOIN skills s ON s.id = es.skill_id;

DROP VIEW IF EXISTS v_experience_tags;
CREATE VIEW v_experience_tags AS
  SELECT et.experience_id, t.name AS tag_name
  FROM experience_tags et JOIN tags t ON t.id = et.tag_id;

DROP VIEW IF EXISTS v_experience_metrics;
CREATE VIEW v_experience_metrics AS
  SELECT experience_id, label, value, unit FROM metrics;

DROP VIEW IF EXISTS v_entities;
CREATE VIEW v_entities AS
  SELECT id, kind, name FROM entities;

DROP VIEW IF EXISTS v_edges;
CREATE VIEW v_edges AS
  SELECT src_kind, src_id, rel, dst_kind, dst_id FROM edges;

DROP VIEW IF EXISTS v_experience_sources;
CREATE VIEW v_experience_sources AS
  SELECT xs.experience_id, s.kind AS source_kind, s.uri_or_path, s.title
  FROM experience_sources xs JOIN sources s ON s.id = xs.source_id;

INSERT OR IGNORE INTO schema_migrations (version) VALUES (7);
