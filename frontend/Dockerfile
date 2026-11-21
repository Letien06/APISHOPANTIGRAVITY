FROM node:24-bookworm-slim

WORKDIR /app
COPY frontend/ ./frontend/

ENV NODE_ENV=production
USER node
CMD ["node", "frontend/server-public.mjs"]
