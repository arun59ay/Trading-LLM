FROM node:18-alpine
WORKDIR /app
COPY package.json ./
RUN npm i
COPY . .
ENV NEXT_PUBLIC_GATEWAY_WS=http://gateway:8080
CMD ["npm","run","dev"]
