# Estágio de Build
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Estágio de Produção (static + proxy de calendário)
FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 80
CMD ["node", "server/calendar-proxy.mjs"]
