FROM node:20-bookworm-slim

# ffmpeg is required for audio extraction and clip cutting
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev=false

COPY . .
RUN npm run build

# Only need prod deps at runtime, but keeping it simple for now
CMD ["npm", "start"]
