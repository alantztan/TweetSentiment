const fs = require('fs');
const path = require('path');
const express = require('express');
const vader = require('vader-sentiment');
let Sentiment;
try {
  Sentiment = require('sentiment');
} catch (_err) {
  Sentiment = null;
}

const PORT = 3010;
const DATA_DIR = path.join(__dirname, 'data');
const TWEETS_PATH = path.join(DATA_DIR, 'Trump_Raw_Tweets.txt');
const POS_PATH = path.join(DATA_DIR, 'positive.txt');
const NEG_PATH = path.join(DATA_DIR, 'negative.txt');
const STOP_PATH = path.join(DATA_DIR, 'stopwords.txt');

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

function loadWordSet(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return new Set(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0 && !line.startsWith(';'))
  );
}

function cleanText(text) {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\brt\b/gi, ' ')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/[\uFE00-\uFE0F]/g, ' ')
    .replace(/[\p{Extended_Pictographic}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  const cleaned = cleanText(text).replace(/[^\w]+/g, ' ').trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s+/)
    .filter((word) => word.length > 1 || word === 'a' || word === 'i');
}

function analyzeTweetsList(tweets, posSet, negSet, stopSet) {
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

  const topList = (freqMap, limit) => {
    return Array.from(freqMap.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([word, count]) => ({ word, count }));
  };

  return {
    counts,
    ratios,
    top: {
      positive: topList(posFreq, 10),
      negative: topList(negFreq, 10),
      stop: topList(stopFreq, 10),
      other: topList(otherFreq, 10),
    },
  };
}

function analyzeTweetsVader(tweets, stopSet) {
  const totals = {
    totalTweets: tweets.length,
    positive: 0,
    negative: 0,
    neutral: 0,
  };
  let compoundSum = 0;
  const wordFreq = new Map();

  const samples = {
    positive: null,
    negative: null,
    neutral: null,
  };

  for (const tweet of tweets) {
    const cleaned = cleanText(tweet);
    const tokens = tokenize(tweet);
    if (!cleaned) continue;
    for (const word of tokens) {
      if (word === 'trump' || stopSet.has(word)) continue;
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
    const scores = vader.SentimentIntensityAnalyzer.polarity_scores(cleaned);
    compoundSum += scores.compound;
    if (scores.compound >= 0.05) {
      totals.positive += 1;
      if (!samples.positive) samples.positive = { text: cleaned, scores };
    } else if (scores.compound <= -0.05) {
      totals.negative += 1;
      if (!samples.negative) samples.negative = { text: cleaned, scores };
    } else {
      totals.neutral += 1;
      if (!samples.neutral) samples.neutral = { text: cleaned, scores };
    }
  }

  const ratios = {
    positive: totals.totalTweets ? totals.positive / totals.totalTweets : 0,
    negative: totals.totalTweets ? totals.negative / totals.totalTweets : 0,
    neutral: totals.totalTweets ? totals.neutral / totals.totalTweets : 0,
  };

  return {
    totals,
    ratios,
    compoundAvg: totals.totalTweets ? compoundSum / totals.totalTweets : 0,
    samples,
    topWords: Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 25)
      .map(([word, count]) => ({ word, count })),
  };
}

const tweets = loadTweets(TWEETS_PATH);
const stopSet = loadWordSet(STOP_PATH);
const posSet = loadWordSet(POS_PATH);
const negSet = loadWordSet(NEG_PATH);
posSet.delete('trump');
const analysisVader = analyzeTweetsVader(tweets, stopSet);
const analysisList = analyzeTweetsList(tweets, posSet, negSet, stopSet);
function analyzeTweetsTextBlobLike(tweets) {
  if (!Sentiment) return null;
  const sentiment = new Sentiment();
  const totals = {
    totalTweets: tweets.length,
    positive: 0,
    negative: 0,
    neutral: 0,
  };
  let scoreSum = 0;

  for (const tweet of tweets) {
    const cleaned = cleanText(tweet);
    if (!cleaned) continue;
    const result = sentiment.analyze(cleaned);
    scoreSum += result.score;
    if (result.score > 0) {
      totals.positive += 1;
    } else if (result.score < 0) {
      totals.negative += 1;
    } else {
      totals.neutral += 1;
    }
  }

  const ratios = {
    positive: totals.totalTweets ? totals.positive / totals.totalTweets : 0,
    negative: totals.totalTweets ? totals.negative / totals.totalTweets : 0,
    neutral: totals.totalTweets ? totals.neutral / totals.totalTweets : 0,
  };

  return {
    totals,
    ratios,
    scoreAvg: totals.totalTweets ? scoreSum / totals.totalTweets : 0,
  };
}

const analysisTextBlob = analyzeTweetsTextBlobLike(tweets);

const app = express();

app.use('/public', express.static(path.join(__dirname)));

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tweet Analysis Home</title>
    <style>
      :root {
        --ink: #1f1f1f;
        --muted: #6b6258;
        --card: #fffaf3;
        --line: #e3d9cc;
        --accent: #d18b34;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Georgia", "Times New Roman", serif;
        color: var(--ink);
        background:
          linear-gradient(rgba(246, 242, 235, 0.65), rgba(246, 242, 235, 0.65)),
          url('/public/2311-SentimentAnalysis-1.png');
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
      }
      .wrap {
        max-width: 720px;
        margin: 60px auto;
        padding: 0 20px;
        text-align: center;
      }
      h1 { margin: 0 0 8px; font-size: 34px; }
      p { color: var(--muted); margin: 0 0 24px; }
      .hero {
        margin: 0 auto 18px;
        max-width: 260px;
      }
      .hero img {
        width: 100%;
        height: auto;
        display: block;
        border-radius: 14px;
        border: 1px solid var(--line);
        box-shadow: 0 6px 16px rgba(0,0,0,0.08);
        background: #fff;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
      }
      .compare-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(180px, 1fr));
        gap: 16px;
      }
      .pie-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(240px, 1fr)) !important;
        gap: 16px;
        align-items: start;
      }
      @media (max-width: 700px) {
        .compare-row { grid-template-columns: repeat(2, minmax(160px, 1fr)); }
      }
      @media (max-width: 520px) {
        .compare-row { grid-template-columns: 1fr; }
      }
      .compare-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(180px, 1fr));
        gap: 16px;
      }
      .pie-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(220px, 1fr));
        gap: 16px;
      }
      @media (max-width: 760px) {
        .compare-row { grid-template-columns: repeat(2, minmax(160px, 1fr)); }
      }
      @media (max-width: 480px) {
        .compare-row { grid-template-columns: 1fr; }
      }
      .compare-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(180px, 1fr));
        gap: 16px;
      }
      .chart-card {
        background: #ffffff;
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 16px 18px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.04);
        margin-bottom: 16px;
      }
      canvas { display: block; margin: 0 auto; }
      .chart-card {
        background: #ffffff;
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 16px 18px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.04);
        margin-bottom: 16px;
      }
      canvas { display: block; margin: 0 auto; }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 18px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.04);
      }
      a.button {
        display: inline-block;
        margin-top: 10px;
        padding: 10px 16px;
        border-radius: 999px;
        background: var(--accent);
        color: #fff;
        text-decoration: none;
        font-size: 14px;
      }
      .label {
        text-transform: uppercase;
        letter-spacing: 1px;
        font-size: 12px;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="hero">
        <img src="/public/sentimentAnalysis.jpeg" alt="Sentiment Analysis" />
      </div>
      <h1>Tweet Analysis</h1>
      <p class="sub"><a href="/tweets">Inspect raw tweet</a></p>
      <p>Choose the analysis method.</p>
      <div class="grid">
        <div class="card">
          <div class="label">Lexicon</div>
          <h2>Positive/Negative Lists</h2>
          <a class="button" href="/list">View Analysis</a>
        </div>
        <div class="card">
          <div class="label">Model</div>
          <h2>VADER Sentiment</h2>
          <a class="button" href="/vader">View Analysis</a>
        </div>
        <div class="card">
          <div class="label">Model</div>
          <h2>TextBlob-style (Sentiment)</h2>
          <a class="button" href="/textblob">View Analysis</a>
        </div>
        <div class="card">
          <div class="label">Compare</div>
          <h2>VADER + TextBlob</h2>
          <a class="button" href="/compare">View Combined</a>
        </div>
      </div>
    </div>
  </body>
  </html>`);
});

app.get('/.', (_req, res) => {
  res.redirect('/');
});

app.get('/vader', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VADER Sentiment Summary</title>
    <style>
      :root {
        --bg: #f6f2eb;
        --ink: #1f1f1f;
        --muted: #6b6258;
        --card: #fffaf3;
        --line: #e3d9cc;
        --pos: #cfeeea;
        --neg: #f6d6d2;
        --neu: #eeeeee;
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
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
      }
      .model-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(240px, 1fr));
        gap: 16px;
        align-items: start;
        margin-bottom: 20px;
      }
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(180px, 1fr));
        gap: 16px;
      }
      @media (max-width: 860px) {
        .model-row { grid-template-columns: 1fr; }
      }
      @media (max-width: 640px) {
        .detail-grid { grid-template-columns: 1fr; }
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 16px 18px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.04);
      }
      .card.pos { background: var(--pos); }
      .card.neg { background: var(--neg); }
      .card.neu { background: var(--neu); }
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
      .meta {
        margin-top: 18px;
        color: var(--muted);
        font-size: 13px;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        background: #ffffff;
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px 12px;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>VADER Sentiment Summary</h1>
      <p class="sub">Tweet-level sentiment using vader-sentiment (no word lists).</p>
      <p class="sub"><a href="/">Home</a> | <a href="/vader/most-frequent">Most Frequent Words</a></p>
      <div class="chart-card">
        <div class="label">Sentiment Share</div>
        <canvas id="pie" width="192" height="192"></canvas>
      </div>
      <div id="cards" class="grid"></div>
      <div id="meta" class="meta"></div>
      <div id="samples" class="grid" style="margin-top:16px;"></div>
    </div>
    <script>
      const formatPct = (n) => (n * 100).toFixed(2) + '%';
      const formatNum = (n) => n.toLocaleString();
      fetch('/api/vader-analysis')
        .then((r) => r.json())
        .then((data) => {
          const cards = document.getElementById('cards');
          const items = [
            { key: 'positive', title: 'Positive', cls: 'pos' },
            { key: 'negative', title: 'Negative', cls: 'neg' },
            { key: 'neutral', title: 'Neutral', cls: 'neu' },
          ];
          const drawPie = () => {
            const canvas = document.getElementById('pie');
            const ctx = canvas.getContext('2d');
            const values = [data.ratios.positive, data.ratios.negative, data.ratios.neutral];
            const colors = ['#58b8ad', '#e58b84', '#c9c9c9'];
            const labels = ['Positive', 'Negative', 'Neutral'];
            let start = -Math.PI / 2;
            for (let i = 0; i < values.length; i++) {
              const slice = values[i] * Math.PI * 2;
              ctx.beginPath();
              ctx.moveTo(96, 96);
              ctx.arc(96, 96, 72, start, start + slice);
              ctx.closePath();
              ctx.fillStyle = colors[i];
              ctx.fill();
              const mid = start + slice / 2;
              const x = 96 + Math.cos(mid) * 52;
              const y = 96 + Math.sin(mid) * 52;
              ctx.fillStyle = '#1f1f1f';
              ctx.font = '12px Georgia';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(labels[i] + ' ' + formatPct(values[i]), x, y);
              start += slice;
            }
          };
          drawPie();
          items.forEach(({ key, title, cls }) => {
            const card = document.createElement('div');
            card.className = 'card ' + cls;
            card.innerHTML =
              '<div class="label">' + title + '</div>' +
              '<div class="value">' + formatNum(data.totals[key]) + '</div>' +
              '<div class="ratio">' + formatPct(data.ratios[key]) + ' of tweets</div>';
            cards.appendChild(card);
          });
          const meta = document.getElementById('meta');
          meta.textContent =
            'Tweets: ' + formatNum(data.totals.totalTweets) +
            ' | Avg compound: ' + data.compoundAvg.toFixed(4);

          const samples = document.getElementById('samples');
          const sampleItems = [
            { key: 'positive', title: 'Sample Positive', cls: 'pos' },
            { key: 'negative', title: 'Sample Negative', cls: 'neg' },
            { key: 'neutral', title: 'Sample Neutral', cls: 'neu' },
          ];
          sampleItems.forEach(({ key, title, cls }) => {
            const item = data.samples[key];
            const card = document.createElement('div');
            card.className = 'card ' + cls;
            card.innerHTML =
              '<div class="label">' + title + '</div>' +
              '<pre>' + (item ? item.text : 'No sample') + '</pre>';
            samples.appendChild(card);
          });
        })
        .catch(() => {
          document.getElementById('cards').innerHTML = '<div class="card">Failed to load analysis.</div>';
        });
    </script>
  </body>
  </html>`);
});

app.get('/list', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lexicon Word Analysis</title>
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
      h1 { font-size: 34px; margin: 0 0 6px; letter-spacing: 0.3px; }
      .sub { color: var(--muted); margin: 0 0 28px; }
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
      .value { font-size: 26px; font-weight: 700; }
      .ratio { font-size: 14px; color: var(--muted); }
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
      .meta { margin-top: 22px; color: var(--muted); font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Lexicon Word Analysis</h1>
      <p class="sub">Counts and ratios based on positive/negative/stopword lists.</p>
      <p class="sub"><a href="/">Home</a> | <a href="/list/most-frequent">Most Frequent Words</a></p>
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
      fetch('/api/list-analysis')
        .then((r) => r.json())
        .then((data) => {
          const cards = document.getElementById('cards');
          labels.forEach(({ key, title }) => {
            const count = data.counts[key];
            const ratio = data.ratios[key];
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML =
              '<div class="label">' + title + '</div>' +
              '<div class="value">' + formatNum(count) + '</div>' +
              '<div class="ratio">' + formatPct(ratio) + ' of all words</div>' +
              '<div class="bar"><span style="width:' + (ratio * 100).toFixed(2) + '%"></span></div>';
            cards.appendChild(card);
          });
          const meta = document.getElementById('meta');
          meta.textContent =
            'Total words: ' + formatNum(data.counts.total) +
            ' | Tweets: ' + formatNum(data.source.tweetCount) +
            ' | Source: ' + data.source.tweets;
        })
        .catch(() => {
          document.getElementById('cards').innerHTML = '<div class="card">Failed to load analysis.</div>';
        });
    </script>
  </body>
  </html>`);
});

app.get('/list/most-frequent', (_req, res) => {
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
      h1 { font-size: 34px; margin: 0 0 6px; letter-spacing: 0.3px; }
      .sub { color: var(--muted); margin: 0 0 28px; }
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
      ol { margin: 0; padding-left: 18px; }
      li { margin: 6px 0; }
      a { color: #d18b34; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Most Frequent Words</h1>
      <p class="sub"><a href="/">Home</a> | <a href="/list">Back to summary</a></p>
      <div id="lists" class="grid"></div>
    </div>
    <script>
      const labels = [
        { key: 'positive', title: 'Positive' },
        { key: 'negative', title: 'Negative' },
        { key: 'stop', title: 'Stop Words' },
        { key: 'other', title: 'Other Words' },
      ];
      fetch('/api/list-analysis')
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

app.get('/textblob', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TextBlob-style Sentiment</title>
    <style>
      :root {
        --bg: #f6f2eb;
        --ink: #1f1f1f;
        --muted: #6b6258;
        --card: #fffaf3;
        --line: #e3d9cc;
        --pos: #cfeeea;
        --neg: #f6d6d2;
        --neu: #eeeeee;
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
      h1 { font-size: 34px; margin: 0 0 6px; letter-spacing: 0.3px; }
      .sub { color: var(--muted); margin: 0 0 28px; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 16px 18px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.04);
      }
      .card.pos { background: var(--pos); }
      .card.neg { background: var(--neg); }
      .card.neu { background: var(--neu); }
      .label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 6px;
      }
      .value { font-size: 26px; font-weight: 700; }
      .ratio { font-size: 14px; color: var(--muted); }
      .meta { margin-top: 18px; color: var(--muted); font-size: 13px; }
      a { color: #d18b34; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>TextBlob-style Sentiment</h1>
      <p class="sub">Using the npm \`sentiment\` package (lexicon score).</p>
      <p class="sub"><a href="/">Home</a></p>
      <p id="note" class="sub"></p>
      <div class="chart-card">
        <div class="label">Sentiment Share</div>
        <canvas id="pie" width="192" height="192"></canvas>
      </div>
      <div id="cards" class="grid"></div>
      <div id="meta" class="meta"></div>
    </div>
    <script>
      const formatPct = (n) => (n * 100).toFixed(2) + '%';
      const formatNum = (n) => n.toLocaleString();
      fetch('/api/textblob-analysis')
        .then((r) => r.json())
        .then((data) => {
          const cards = document.getElementById('cards');
          if (data.error) {
            document.getElementById('note').textContent = data.error;
            return;
          }
          const drawPie = () => {
            const canvas = document.getElementById('pie');
            const ctx = canvas.getContext('2d');
            const values = [data.ratios.positive, data.ratios.negative, data.ratios.neutral];
            const colors = ['#58b8ad', '#e58b84', '#c9c9c9'];
            const labels = ['Positive', 'Negative', 'Neutral'];
            let start = -Math.PI / 2;
            for (let i = 0; i < values.length; i++) {
              const slice = values[i] * Math.PI * 2;
              ctx.beginPath();
              ctx.moveTo(96, 96);
              ctx.arc(96, 96, 72, start, start + slice);
              ctx.closePath();
              ctx.fillStyle = colors[i];
              ctx.fill();
              const mid = start + slice / 2;
              const x = 96 + Math.cos(mid) * 52;
              const y = 96 + Math.sin(mid) * 52;
              ctx.fillStyle = '#1f1f1f';
              ctx.font = '12px Georgia';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(labels[i] + ' ' + formatPct(values[i]), x, y);
              start += slice;
            }
          };
          drawPie();
          const items = [
            { key: 'positive', title: 'Positive', cls: 'pos' },
            { key: 'negative', title: 'Negative', cls: 'neg' },
            { key: 'neutral', title: 'Neutral', cls: 'neu' },
          ];
          items.forEach(({ key, title, cls }) => {
            const card = document.createElement('div');
            card.className = 'card ' + cls;
            card.innerHTML =
              '<div class="label">' + title + '</div>' +
              '<div class="value">' + formatNum(data.totals[key]) + '</div>' +
              '<div class="ratio">' + formatPct(data.ratios[key]) + ' of tweets</div>';
            cards.appendChild(card);
          });
          const meta = document.getElementById('meta');
          meta.textContent =
            'Tweets: ' + formatNum(data.totals.totalTweets) +
            ' | Avg score: ' + data.scoreAvg.toFixed(4);
        })
        .catch(() => {
          document.getElementById('cards').innerHTML = '<div class="card">Failed to load analysis.</div>';
        });
    </script>
  </body>
  </html>`);
});

app.get('/compare', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VADER + TextBlob Comparison</title>
    <style>
      :root {
        --bg: #f6f2eb;
        --ink: #1f1f1f;
        --muted: #6b6258;
        --card: #fffaf3;
        --line: #e3d9cc;
        --pos: #cfeeea;
        --neg: #f6d6d2;
        --neu: #eeeeee;
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
      .compare-columns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 22px;
        align-items: start;
      }
      @media (max-width: 960px) {
        .compare-columns { grid-template-columns: 1fr; }
      }
      .model-row {
        display: grid;
        grid-template-columns: 220px 1fr;
        gap: 16px;
        align-items: start;
      }
      @media (max-width: 640px) {
        .model-row { grid-template-columns: 1fr; }
      }
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(130px, 1fr));
        gap: 12px;
      }
      @media (max-width: 480px) {
        .detail-grid { grid-template-columns: 1fr; }
      }
      h1 { font-size: 34px; margin: 0 0 6px; letter-spacing: 0.3px; }
      .sub { color: var(--muted); margin: 0 0 24px; }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 16px 18px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.04);
      }
      .card.pos { background: var(--pos); }
      .card.neg { background: var(--neg); }
      .card.neu { background: var(--neu); }
      .label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 6px;
      }
      .value { font-size: 26px; font-weight: 700; }
      .ratio { font-size: 14px; color: var(--muted); }
      .section { margin-bottom: 26px; }
      .chart-card {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 12px;
        box-shadow: 0 4px 10px rgba(0,0,0,0.04);
        width: 85%;
        justify-self: center;
      }
      .detail-grid .card {
        width: 85%;
        justify-self: center;
      }
      canvas { display: block; margin: 0 auto; }
      a { color: #d18b34; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>VADER + TextBlob Comparison</h1>
      <p class="sub"><a href="/">Home</a></p>
      <div class="compare-columns">
        <div class="section">
          <h2>VADER</h2>
          <div class="model-row">
            <div id="vader-pie-wrap" class="chart-card">
              <div class="label">VADER Share</div>
              <canvas id="vader-pie" width="175" height="175"></canvas>
            </div>
            <div id="vader-cards" class="detail-grid"></div>
          </div>
        </div>
        <div class="section">
          <h2>TextBlob-style</h2>
          <p id="textblob-note" class="sub"></p>
          <div class="model-row">
            <div id="textblob-pie-wrap" class="chart-card">
              <div class="label">TextBlob Share</div>
              <canvas id="textblob-pie" width="175" height="175"></canvas>
            </div>
            <div id="textblob-cards" class="detail-grid"></div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const formatPct = (n) => (n * 100).toFixed(2) + '%';
      const formatNum = (n) => n.toLocaleString();
      function drawPie(canvasId, ratios) {
        const canvas = document.getElementById(canvasId);
        const ctx = canvas.getContext('2d');
        const values = [ratios.positive, ratios.negative, ratios.neutral];
        const colors = ['#58b8ad', '#e58b84', '#c9c9c9'];
        const labels = ['Positive', 'Negative', 'Neutral'];
        let start = -Math.PI / 2;
        for (let i = 0; i < values.length; i++) {
          const slice = values[i] * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(87, 87);
          ctx.arc(87, 87, 65, start, start + slice);
          ctx.closePath();
          ctx.fillStyle = colors[i];
          ctx.fill();
          const mid = start + slice / 2;
          const x = 87 + Math.cos(mid) * 45;
          const y = 87 + Math.sin(mid) * 45;
          ctx.fillStyle = '#1f1f1f';
          ctx.font = '12px Georgia';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(labels[i] + ' ' + formatPct(values[i]), x, y);
          start += slice;
        }
      }
      function renderCards(targetId, data) {
        const target = document.getElementById(targetId);
        const items = [
          { key: 'positive', title: 'Positive', cls: 'pos' },
          { key: 'negative', title: 'Negative', cls: 'neg' },
          { key: 'neutral', title: 'Neutral', cls: 'neu' },
        ];
        items.forEach(({ key, title, cls }) => {
          const card = document.createElement('div');
          card.className = 'card ' + cls;
          card.innerHTML =
            '<div class="label">' + title + '</div>' +
            '<div class="value">' + formatNum(data.totals[key]) + '</div>' +
            '<div class="ratio">' + formatPct(data.ratios[key]) + ' of tweets</div>';
          target.appendChild(card);
        });
      }
      fetch('/api/vader-analysis')
        .then((r) => r.json())
        .then((data) => {
          drawPie('vader-pie', data.ratios);
          renderCards('vader-cards', data);
        });

      fetch('/api/textblob-analysis')
        .then((r) => r.json())
        .then((data) => {
          if (data.error) {
            document.getElementById('textblob-note').textContent = data.error;
            return;
          }
          drawPie('textblob-pie', data.ratios);
          renderCards('textblob-cards', data);
        })
        .catch(() => {
          document.getElementById('textblob-note').textContent = 'Failed to load TextBlob analysis.';
        });
    </script>
  </body>
  </html>`);
});

app.get('/most-frequent', (_req, res) => {
  res.redirect('/vader/most-frequent');
});

app.get('/vader/most-frequent', (_req, res) => {
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
        max-width: 680px;
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
      ol {
        margin: 0;
        padding-left: 18px;
      }
      li { margin: 6px 0; }
      a { color: #d18b34; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Most Frequent Words</h1>
      <p class="sub"><a href="/">Home</a> | <a href="/vader">Back to summary</a></p>
      <div class="card">
        <div class="label">Top 25 Words (All Tweets)</div>
        <ol id="list"></ol>
      </div>
    </div>
    <script>
      fetch('/api/vader-analysis')
        .then((r) => r.json())
        .then((data) => {
          const list = document.getElementById('list');
          const items = data.topWords || [];
          if (!items.length) {
            list.innerHTML = '<li>No data</li>';
            return;
          }
          list.innerHTML = items
            .map((item) => '<li>' + item.word + ' — ' + item.count.toLocaleString() + '</li>')
            .join('');
        })
        .catch(() => {
          document.getElementById('list').innerHTML = '<li>Failed to load</li>';
        });
    </script>
  </body>
  </html>`);
});

app.get('/api/vader-analysis', (_req, res) => {
  res.json({
    source: {
      tweets: path.basename(TWEETS_PATH),
      tweetCount: tweets.length,
    },
    totals: analysisVader.totals,
    ratios: analysisVader.ratios,
    compoundAvg: analysisVader.compoundAvg,
    samples: analysisVader.samples,
    topWords: analysisVader.topWords,
  });
});

app.get('/api/list-analysis', (_req, res) => {
  res.json({
    source: {
      tweets: path.basename(TWEETS_PATH),
      positive: path.basename(POS_PATH),
      negative: path.basename(NEG_PATH),
      stopwords: path.basename(STOP_PATH),
      tweetCount: tweets.length,
    },
    counts: analysisList.counts,
    ratios: analysisList.ratios,
    top: analysisList.top,
  });
});

app.get('/api/textblob-analysis', (_req, res) => {
  if (!analysisTextBlob) {
    res.status(503).json({ error: 'TextBlob-style analysis unavailable. Install npm package sentiment.' });
    return;
  }
  res.json({
    source: {
      tweets: path.basename(TWEETS_PATH),
      tweetCount: tweets.length,
    },
    totals: analysisTextBlob.totals,
    ratios: analysisTextBlob.ratios,
    scoreAvg: analysisTextBlob.scoreAvg,
  });
});

app.get('/api/analysis', (req, res) => {
  res.redirect(307, '/api/vader-analysis');
});

app.get('/tweets', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cleaned Tweets</title>
    <style>
      :root {
        --bg: #f6f2eb;
        --ink: #1f1f1f;
        --muted: #6b6258;
        --card: #fffaf3;
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
      h1 { font-size: 34px; margin: 0 0 6px; letter-spacing: 0.3px; }
      .sub { color: var(--muted); margin: 0 0 18px; }
      .controls { display: flex; gap: 10px; margin-bottom: 14px; }
      .controls input {
        flex: 1;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid var(--line);
        font-family: inherit;
      }
      .tweet {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px 14px;
        margin-bottom: 10px;
      }
      .idx { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
      a { color: #d18b34; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Cleaned Tweets</h1>
      <p class="sub"><a href="/">Home</a></p>
      <div class="controls">
        <input id="filter" type="text" placeholder="Filter by keyword (optional)" />
      </div>
      <div id="list"></div>
    </div>
    <script>
      const list = document.getElementById('list');
      const filter = document.getElementById('filter');
      let tweets = [];
      const render = () => {
        const q = filter.value.trim().toLowerCase();
        const data = q ? tweets.filter(t => t.text.includes(q)) : tweets;
        list.innerHTML = data.map(t => (
          '<div class="tweet">' +
          '<div class="idx">#' + t.index + '</div>' +
          '<div class="text">' + t.text + '</div>' +
          '</div>'
        )).join('') || '<div class="tweet">No results</div>';
      };
      fetch('/api/clean-tweets')
        .then(r => r.json())
        .then(data => {
          tweets = data.tweets;
          render();
        });
      filter.addEventListener('input', render);
    </script>
  </body>
  </html>`);
});

app.get('/api/clean-tweets', (_req, res) => {
  const cleaned = tweets.map((t, i) => ({ index: i + 1, text: cleanText(t) }))
    .filter((t) => t.text.length > 0);
  res.json({ tweets: cleaned });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`VADER server listening on http://localhost:${PORT}`);
});
