# Architecture — Data Model

Part of the [architecture spec](../architecture.md)

## Schema (SQLite, one file)

```sql
experiences(id, title, situation, task, action, result_text,
            context,            -- work | project | class | other
            happened_start, happened_end,
            status,             -- draft | confirmed
            draft_state_json,   -- unanswered gap questions + per-field confidence, so
                                -- AI-proposed drafts reopen mid-conversation, not as a blank form
            created_at, updated_at)
skills(id, name UNIQUE, kind)                 -- technical | soft | domain
experience_skills(experience_id, skill_id)
tags(id, name UNIQUE)  /  experience_tags(experience_id, tag_id)
metrics(id, experience_id, label, value, unit)          -- concrete results

sources(id, kind,               -- paste | file | url | repo | spreadsheet | code
        uri_or_path,            -- original location (may rot)
        attachment_path,        -- our copy: imported files land in a content-hash-named
                                -- attachments dir under userData, so provenance survives
                                -- the user moving/deleting the original
        title, raw_text, meta_json, content_hash, ingested_at)
experience_sources(experience_id, source_id)            -- provenance chain

corpus_docs(id, title, discipline, source_id)           -- technical-interview reference material
corpus_chunks(id, doc_id, seq, text)

practice_sessions(id, mode,     -- behavioral | technical
                  config_json,  -- jd / genre / discipline
                  started_at, ended_at)
practice_turns(id, session_id, role, content, feedback_json,
               flags_json,      -- e.g. "told a story that isn't banked yet"
               created_at)
practice_turn_experiences(turn_id, experience_id)       -- which banked experiences an answer used
stories(id, kind,               -- story | bullets | resume
        prompt_json, content, experience_ids_json,
        parent_story_id, notes, -- regenerate-with-notes lineage
        created_at)

usage_log(id, ts, model, in_tokens, out_tokens, cache_read_tokens, feature)
settings(key, value)  /  schema_migrations(version)

-- knowledge-graph layer (lands with heavy ingestion, Stage 7 — additive migration)
entities(id, kind,              -- person | team | project | org | tool | other
         name, meta_json, created_at)
edges(id, src_kind, src_id,     -- experience | entity | source
      rel,                      -- worked_with | part_of | used | produced | …
      dst_kind, dst_id, meta_json)

-- search layer
experiences_fts   -- FTS5 over title/situation/task/action/result_text (external-content;
                  -- insert/update/delete triggers keep it in sync — external-content FTS
                  -- silently desyncs without them)
corpus_fts        -- FTS5 over corpus_chunks.text
vec_experiences   -- sqlite-vec vec0, float[384], one "experience card" embedding
                  -- (title + STAR + skills composed into one passage)
vec_corpus        -- float[384] per corpus chunk
```

## Graph model, not graph engine

The concept doc's "graph of experiences, skills, and results" is a **graph model, not a graph engine**: typed join tables for the core relations, plus the generic `entities`/`edges` property-graph layer for what heavy dumping surfaces beyond the fixed schema (people, teams, projects, tools — LLM-extracted at ingest time, Stage 7). All queries here are 1–2-hop traversals, which SQL joins do natively; the data volume from dumping is document/vector-shaped and lands in `sources`/`corpus_chunks`. A dedicated graph DB was considered and rejected (user-confirmed): no-server rules out Neo4j, the leading embedded option Kuzu was archived in Oct 2025 with only months-old forks, and it would split the data into two stores — losing single-file backup and cross-store transactions — for query shapes this app never issues. If graph algorithms are ever wanted, a few thousand edges load into an in-memory graph (graphology) in milliseconds.
