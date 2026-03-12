This folder contains a Tweet Sentiment Analysis based on ~3700 tweets with keyword "trump".
There is 3 Docker containers:
- postgres (pgvector/pgvector:pg17)
- web (c54928105c9b mar-3-2026-web:latest 3000:3000)
- importer (4eb4681acd6b49fb4de0efa9ad6ba18b49172e959a344a5f2c4f7b086c58b6f5)

Use "docker compose up -d --build" to start the app, then use  http://localhost:3000 to view the app. (need Docker Desktop running first)

any issue, contact alan.tz.tan@gmail.com

