FROM apify/actor-node:20 AS build

COPY package*.json ./
RUN npm --quiet set progress=false && npm ci

COPY . ./
RUN npm run build

FROM apify/actor-node:20

COPY package*.json ./
RUN npm --quiet set progress=false && npm ci --omit=dev --omit=optional

COPY --from=build /usr/src/app/dist ./dist

CMD ["npm", "start"]
