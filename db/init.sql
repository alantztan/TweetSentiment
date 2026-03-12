CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS lexicon_words (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('positive', 'negative', 'stopword')),
  word TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, word)
);

CREATE TABLE IF NOT EXISTS tweets (
  id BIGSERIAL PRIMARY KEY,
  source_file TEXT NOT NULL DEFAULT 'Trump_Raw_Tweets.txt',
  line_no INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_file, line_no)
);
