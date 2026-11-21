FROM node:24-bookworm-slim

WORKDIR /app
RUN mkdir -p /app/data && chown node:node /app/data
COPY src/ ./src/

ENV NODE_ENV=production
USER node
CMD ["node", "src/server.mjs"]
