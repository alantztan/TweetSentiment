const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const TWEETS_PATH = path.join(DATA_DIR, 'Trump_Raw_Tweets.txt');
const POS_PATH = path.join(DATA_DIR, 'positive.txt');
const NEG_PATH = path.join(DATA_DIR, 'negative.txt');
const STOP_PATH = path.join(DATA_DIR, 'stopwords.txt');

function loadWordSet(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const words = raw
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0 && !line.startsWith(';'));
  return new Set(words);
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
    if (next === '\'' ) {
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

function tokenize(text) {
  const cleaned = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/[\uFE00-\uFE0F]/g, ' ')
    .replace(/[\p{Extended_Pictographic}]/gu, ' ')
    .replace(/[^\w]+/g, ' ')
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s+/)
    .filter((word) => word !== 'rt')
    .filter((word) => word.length > 1 || word === 'a' || word === 'i');
}

function analyzeTweets(tweets, posSet, negSet, stopSet) {
  const counts = {
    total: 0,
    positive: 0,
    negative: 0,
    stop: 0,
    other: 0,
  };
  const posFreq = new Map();
  const negFreq = new Map();
  const stopFreq = new Map();
  const otherFreq = new Map();

  for (const tweet of tweets) {
    const tokens = tokenize(tweet);
    for (const word of tokens) {
      counts.total += 1;
      if (posSet.has(word)) {
        counts.positive += 1;
        posFreq.set(word, (posFreq.get(word) || 0) + 1);
      } else if (negSet.has(word)) {
        counts.negative += 1;
        negFreq.set(word, (negFreq.get(word) || 0) + 1);
      } else if (stopSet.has(word)) {
        counts.stop += 1;
        stopFreq.set(word, (stopFreq.get(word) || 0) + 1);
      } else {
        counts.other += 1;
        otherFreq.set(word, (otherFreq.get(word) || 0) + 1);
      }
    }
  }

  const ratios = {
    positive: counts.total ? counts.positive / counts.total : 0,
    negative: counts.total ? counts.negative / counts.total : 0,
    stop: counts.total ? counts.stop / counts.total : 0,
    other: counts.total ? counts.other / counts.total : 0,
  };

  const topList = (freqMap) => {
    return Array.from(freqMap.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }));
  };

  return {
    counts,
    ratios,
    top: {
      positive: topList(posFreq),
      negative: topList(negFreq),
      stop: topList(stopFreq),
      other: topList(otherFreq),
    },
  };
}

const posSet = loadWordSet(POS_PATH);
const negSet = loadWordSet(NEG_PATH);
const stopSet = loadWordSet(STOP_PATH);
// Exclude the keyword itself from positive scoring.
posSet.delete('trump');
const tweets = loadTweets(TWEETS_PATH);
const analysis = analyzeTweets(tweets, posSet, negSet, stopSet);

const app = express();

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tweet Word Analysis</title>
    <style>
      :root {
        --bg: #f6f2eb;
        --ink: #1f1f1f;
        --muted: #6b6258;
        --card: #fffaf3;
        --accent: #d18b34;
        --line: #e3d9cc;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Georgia", "Times New Roman", serif;
        color: var(--ink);
        background: radial-gradient(circle at 20% 20%, #fff5e5, #f2e9dc 60%, #efe3d2 100%);
      }
      .wrap {
        max-width: 980px;
        margin: 40px auto 60px;
        padding: 0 20px;
      }
      h1 {
        font-size: 34px;
        margin: 0 0 6px;
        letter-spacing: 0.3px;
      }
      .sub {
        color: var(--muted);
        margin: 0 0 28px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 16px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 16px 18px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.04);
      }
      .label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 6px;
      }
      .value {
        font-size: 26px;
        font-weight: 700;
      }
      .ratio {
        font-size: 14px;
        color: var(--muted);
      }
      .bar {
        height: 10px;
        background: #f1e6d7;
        border-radius: 999px;
        overflow: hidden;
        margin-top: 10px;
        border: 1px solid var(--line);
      }
      .bar > span {
        display: block;
        height: 100%;
        background: var(--accent);
        width: 0%;
        transition: width 600ms ease;
      }
      .meta {
        margin-top: 22px;
        color: var(--muted);
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Tweet Word Analysis</h1>
      <p class="sub">Counts and ratios of words in the Trump tweet collection.</p>
      <p class="sub"><a href="/most-frequent">Most Frequent Words</a></p>
      <div id="cards" class="grid"></div>
      <div id="meta" class="meta"></div>
    </div>
    <script>
      const formatPct = (n) => (n * 100).toFixed(2) + '%';
      const formatNum = (n) => n.toLocaleString();
      const labels = [
        { key: 'positive', title: 'Positive' },
        { key: 'negative', title: 'Negative' },
        { key: 'stop', title: 'Stop Words' },
        { key: 'other', title: 'Other' },
      ];
      fetch('/api/analysis')
        .then((r) => r.json())
        .then((data) => {
          const cards = document.getElementById('cards');
          labels.forEach(({ key, title }) => {
            const count = data.counts[key];
            const ratio = data.ratios[key];
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = \`
              <div class="label">\${title}</div>
              <div class="value">\${formatNum(count)}</div>
              <div class="ratio">\${formatPct(ratio)} of all words</div>
              <div class="bar"><span style="width:\${(ratio * 100).toFixed(2)}%"></span></div>
            \`;
            cards.appendChild(card);
          });
          const meta = document.getElementById('meta');
          meta.textContent = \`Total words: \${formatNum(data.counts.total)} | Tweets: \${formatNum(data.source.tweetCount)} | Source: \${data.source.tweets}\`;
        })
        .catch(() => {
          document.getElementById('cards').innerHTML = '<div class="card">Failed to load analysis.</div>';
        });
    </script>
  </body>
  </html>`);
});

app.get('/most-frequent', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Most Frequent Words</title>
    <style>
      :root {
        --bg: #f6f2eb;
        --ink: #1f1f1f;
        --muted: #6b6258;
        --card: #fffaf3;
        --accent: #d18b34;
        --line: #e3d9cc;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Georgia", "Times New Roman", serif;
        color: var(--ink);
        background: radial-gradient(circle at 20% 20%, #fff5e5, #f2e9dc 60%, #efe3d2 100%);
      }
      .wrap {
        max-width: 980px;
        margin: 40px auto 60px;
        padding: 0 20px;
      }
      h1 {
        font-size: 34px;
        margin: 0 0 6px;
        letter-spacing: 0.3px;
      }
      .sub {
        color: var(--muted);
        margin: 0 0 28px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(200px, 1fr));
        gap: 16px;
      }
      @media (max-width: 900px) {
        .grid { grid-template-columns: repeat(2, minmax(200px, 1fr)); }
      }
      @media (max-width: 560px) {
        .grid { grid-template-columns: 1fr; }
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 16px 18px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.04);
      }
      .label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 8px;
      }
      .card.positive { background: #cfeeea; }
      .card.negative { background: #f6d6d2; }
      .card.stop { background: #eeeeee; }
      .card.other { background: #d6e6ff; }
      ol {
        margin: 0;
        padding-left: 18px;
      }
      li {
        margin: 6px 0;
      }
      a { color: var(--accent); text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Most Frequent Words</h1>
      <p class="sub"><a href="/">Back to summary</a></p>
      <div id="lists" class="grid"></div>
    </div>
    <script>
      const labels = [
        { key: 'positive', title: 'Positive' },
        { key: 'negative', title: 'Negative' },
        { key: 'stop', title: 'Stop Words' },
        { key: 'other', title: 'Other Words' },
      ];
      fetch('/api/analysis')
        .then((r) => r.json())
        .then((data) => {
          const lists = document.getElementById('lists');
          labels.forEach(({ key, title }) => {
            const items = data.top[key] || [];
            const card = document.createElement('div');
            card.className = 'card ' + key;
            const listItems = items
              .map((item) => '<li>' + item.word + ' — ' + item.count.toLocaleString() + '</li>')
              .join('');
            card.innerHTML =
              '<div class="label">' + title + '</div>' +
              '<ol>' + (listItems || '<li>No data</li>') + '</ol>';
            lists.appendChild(card);
          });
        })
        .catch(() => {
          document.getElementById('lists').innerHTML = '<div class="card">Failed to load analysis.</div>';
        });
    </script>
  </body>
  </html>`);
});

app.get('/api/analysis', (_req, res) => {
  res.json({
    source: {
      tweets: path.basename(TWEETS_PATH),
      positive: path.basename(POS_PATH),
      negative: path.basename(NEG_PATH),
      stopwords: path.basename(STOP_PATH),
      tweetCount: tweets.length,
    },
    counts: analysis.counts,
    ratios: analysis.ratios,
    top: analysis.top,
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`);
});
