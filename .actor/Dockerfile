FROM apify/actor-node:20

COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional

COPY . ./
RUN npm install --include=dev \
    && npm run build

CMD ["npm", "start"]
