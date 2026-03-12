# Tweet Sentiment Analysis

A Node.js sentiment analysis project for Trump tweet data, with:
- A web UI (VADER-focused dashboard)
- Lexicon-based analysis (positive/negative/stopwords)
- PostgreSQL + pgvector storage in Docker
- Data import pipeline from local text files in `./data`

## Tech Stack

- Node.js + Express
- `vader-sentiment`
- `sentiment`
- PostgreSQL 17 + `pgvector/pgvector:pg17`
- Docker Compose

## Data Files

The importer reads:
- `data/Trump_Raw_Tweets.txt`
- `data/positive.txt`
- `data/negative.txt`
- `data/stopwords.txt`

## Quick Start (Docker: Recommended)

1. Clone and enter the project:
```bash
git clone https://github.com/alantztan/TweetSentiment.git
cd TweetSentiment
```

2. Create env file:
```bash
cp .env.example .env
```

3. Build and start web + database:
```bash
docker compose up -d --build
```

4. Import data into Postgres:
```bash
docker compose run --rm importer
```

5. Open app:
- http://localhost:3000

## Docker Services

- `postgres`: pgvector-enabled PostgreSQL (`host:5433 -> container:5432`)
- `web`: Express app (`host:3000 -> container:3000`)
- `importer`: one-off container to load `./data` into DB

Check status:
```bash
docker compose ps
```

Stop everything:
```bash
docker compose down
```

## Verify Database Content

Count tweets:
```bash
docker compose exec postgres psql -U postgres -d tweet_sentiment -c "SELECT COUNT(*) AS tweets FROM tweets;"
```

Count lexicon rows by source:
```bash
docker compose exec postgres psql -U postgres -d tweet_sentiment -c "SELECT source, COUNT(*) FROM lexicon_words GROUP BY source ORDER BY source;"
```

List tables:
```bash
docker compose exec postgres psql -U postgres -d tweet_sentiment -c "\dt"
```

## Local Run (Without Docker for Web)

Install dependencies:
```bash
npm install
```

Run standard app:
```bash
npm start
```

Run VADER app (full dashboard):
```bash
npm run start:vader
```

## NPM Scripts

- `npm start` -> run `server.js`
- `npm run start:vader` -> run `server_vader.js`
- `npm run db:up` -> start Postgres container
- `npm run db:down` -> stop compose stack
- `npm run db:import` -> import `./data` into Postgres

## Main API Endpoints

- `GET /api/health`
- `GET /api/analysis`
- `GET /api/vader-analysis`
- `GET /api/list-analysis`
- `GET /api/textblob-analysis`
- `GET /api/clean-tweets`

## Project Structure

```text
.
├── data/
├── db/
│   └── init.sql
├── scripts/
│   └── import-data-to-postgres.js
├── server.js
├── server_vader.js
├── docker-compose.yml
├── Dockerfile
└── .env.example
```
