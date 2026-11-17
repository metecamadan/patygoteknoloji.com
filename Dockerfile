FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production PORT=3000 BIND_HOST=0.0.0.0 PATYGO_DATA_ROOT=/data
EXPOSE 3000
CMD ["npm", "start"]
