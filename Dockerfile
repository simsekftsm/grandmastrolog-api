FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip fonts-dejavu-core fonts-liberation2 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN pip3 install --no-cache-dir --break-system-packages Pillow==11.3.0 reportlab==4.4.3

ENV NODE_ENV=production
ENV PYTHON_BIN=python3

CMD ["node", "index.js"]
