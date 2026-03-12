const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const TWEETS_PATH = path.join(DATA_DIR, 'Trump_Raw_Tweets.txt');
const POS_PATH = path.join(DATA_DIR, 'positive.txt');
const NEG_PATH = path.join(DATA_DIR, 'negative.txt');
const STOP_PATH = path.join(DATA_DIR, 'stopwords.txt');

function loadWordList(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0 && !line.startsWith(';'));
}

function decodePythonBytesLiteral(body) {
  const bytes = [];
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      bytes.push(ch.codePointAt(0));
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) {
      bytes.push('\\'.codePointAt(0));
      continue;
    }
    if (next === 'n') {
      bytes.push(10);
      i += 1;
      continue;
    }
    if (next === 'r') {
      bytes.push(13);
      i += 1;
      continue;
    }
    if (next === 't') {
      bytes.push(9);
      i += 1;
      continue;
    }
    if (next === '\\') {
      bytes.push(92);
      i += 1;
      continue;
    }
    if (next === "'") {
      bytes.push(39);
      i += 1;
      continue;
    }
    if (next === '"') {
      bytes.push(34);
      i += 1;
      continue;
    }
    if (next === 'x' && i + 3 < body.length) {
      const hex = body.slice(i + 2, i + 4);
      const val = Number.parseInt(hex, 16);
      if (!Number.isNaN(val)) {
        bytes.push(val);
        i += 3;
        continue;
      }
    }
    if (next === 'u' && i + 5 < body.length) {
      const hex = body.slice(i + 2, i + 6);
      const codepoint = Number.parseInt(hex, 16);
      if (!Number.isNaN(codepoint)) {
        const buf = Buffer.from(String.fromCodePoint(codepoint), 'utf8');
        for (const b of buf) bytes.push(b);
        i += 5;
        continue;
      }
    }
    if (next === 'U' && i + 9 < body.length) {
      const hex = body.slice(i + 2, i + 10);
      const codepoint = Number.parseInt(hex, 16);
      if (!Number.isNaN(codepoint)) {
        const buf = Buffer.from(String.fromCodePoint(codepoint), 'utf8');
        for (const b of buf) bytes.push(b);
        i += 9;
        continue;
      }
    }
    bytes.push(next.codePointAt(0));
    i += 1;
  }
  return Buffer.from(bytes).toString('utf8');
}

function parsePythonBytesDump(raw) {
  const parts = [];
  const regex = /b'((?:\\.|[^'])*?)'|b"((?:\\.|[^"])*?)"/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const body = match[1] ?? match[2] ?? '';
    parts.push(decodePythonBytesLiteral(body));
  }
  const joined = parts.join('');
  return joined.split(/\r?\n/).filter((line) => line.length > 0);
}

function loadTweets(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (raw.includes("b'") || raw.includes('b"')) {
    return parsePythonBytesDump(raw);
  }
  return raw.split(/\r?\n/).filter((line) => line.length > 0);
}

function makeInsertSQL(table, columns, rowCount) {
  const values = [];
  for (let i = 0; i < rowCount; i += 1) {
    const placeholders = [];
    for (let j = 0; j < columns.length; j += 1) {
      placeholders.push(`$${i * columns.length + j + 1}`);
    }
    values.push(`(${placeholders.join(', ')})`);
  }
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')}`;
}

async function bulkInsert(client, table, columns, rows, chunkSize = 1000, suffix = '') {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const flatValues = chunk.flat();
    const sql = `${makeInsertSQL(table, columns, chunk.length)} ${suffix}`;
    await client.query(sql, flatValues);
  }
}

async function main() {
  const client = new Client({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || process.env.DB_PORT || 5433),
    user: process.env.PGUSER || process.env.POSTGRES_USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.PGDATABASE || process.env.POSTGRES_DB || 'tweet_sentiment',
  });

  const schemaSQL = fs.readFileSync(path.join(ROOT, 'db', 'init.sql'), 'utf8');

  const positiveWords = loadWordList(POS_PATH);
  const negativeWords = loadWordList(NEG_PATH);
  const stopWords = loadWordList(STOP_PATH);
  const tweets = loadTweets(TWEETS_PATH);

  const lexiconRows = [
    ...positiveWords.map((word) => ['positive', word]),
    ...negativeWords.map((word) => ['negative', word]),
    ...stopWords.map((word) => ['stopword', word]),
  ];
  const tweetRows = tweets.map((tweet, idx) => ['Trump_Raw_Tweets.txt', idx + 1, tweet]);

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(schemaSQL);
    await client.query('TRUNCATE TABLE lexicon_words, tweets RESTART IDENTITY');

    await bulkInsert(
      client,
      'lexicon_words',
      ['source', 'word'],
      lexiconRows,
      1000,
      'ON CONFLICT (source, word) DO NOTHING'
    );

    await bulkInsert(client, 'tweets', ['source_file', 'line_no', 'raw_text'], tweetRows, 500);

    await client.query('COMMIT');
    console.log(
      `Imported ${tweetRows.length} tweets and ${lexiconRows.length} lexicon rows into Postgres.`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exitCode = 1;
});
