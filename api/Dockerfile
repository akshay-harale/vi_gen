FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
# Fallback to node index.js if start script is not present
CMD ["node", "index.js"]
