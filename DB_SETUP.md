# Postgres Data Load (pgvector)

## 1. Configure env

```bash
cp .env.example .env
```

## 2. Build and start everything (DB + web)

```bash
docker compose up -d --build
```

The container maps to host port `5433` by default to avoid conflicts with local PostgreSQL on `5432`.

Web app is available at `http://localhost:3000`.

## 3. Install dependencies

```bash
npm install
```

## 4. Import `./data` files into Postgres

```bash
docker compose run --rm importer
```

## 5. Verify counts

```bash
docker compose exec postgres psql -U postgres -d tweet_sentiment -c "SELECT COUNT(*) AS tweets FROM tweets;"
docker compose exec postgres psql -U postgres -d tweet_sentiment -c "SELECT source, COUNT(*) FROM lexicon_words GROUP BY source ORDER BY source;"
```

## Notes

- `tweets.embedding` is a `vector(1536)` column for future embeddings.
- Re-running `npm run db:import` replaces table contents (truncate + reload).
