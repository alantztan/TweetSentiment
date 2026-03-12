FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY data ./data
COPY db ./db
COPY scripts ./scripts
COPY server.js ./server.js
COPY server_vader.js ./server_vader.js
COPY 2311-SentimentAnalysis-1.png ./2311-SentimentAnalysis-1.png
COPY sentimentAnalysis.jpeg ./sentimentAnalysis.jpeg

EXPOSE 3000

CMD ["npm", "start"]
