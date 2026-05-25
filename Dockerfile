FROM node:18

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash

ENV PATH="/root/.bun/bin:$PATH"
ENV HUSKY=0

WORKDIR /app

ARG GITHUB_TOKEN

COPY package.json .npmrc ./

RUN test -n "$GITHUB_TOKEN" \
  && sed -i.bak 's|"@yidongw/pawx-schemas": "link:@yidongw/pawx-schemas"|"@yidongw/pawx-schemas": "beta"|g' package.json \
  && rm -f package.json.bak \
  && bun install \
  && rm -f .npmrc

COPY . .

EXPOSE 3000

CMD ["bun", "run", "src/main.ts"]
