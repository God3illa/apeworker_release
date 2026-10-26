FROM node:20-alpine

WORKDIR /frontend

COPY package*.json ./
RUN npm install --cache ./npm-cache

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "NODE_OPTIONS='--max-old-space-size=1024' npm run build && npm run start"]
