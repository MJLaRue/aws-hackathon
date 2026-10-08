FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html dashboard.html forecasting.html vite.config.js ./
COPY frontend ./frontend
COPY src ./src
COPY public ./public
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package*.json ./
COPY --chown=node:node server ./server
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]
