FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8094 DB_PATH=/app/storage/chess.sqlite
WORKDIR /app
COPY --chown=node:node . /app/
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 8094
CMD ["node", "src/server.js"]
