# Viacstupnovy build: Vite/React je cisto klientska SPA, takze vysledny
# obraz len servuje staticke subory (dist/) cez nginx - ziadny Node beziaci
# v produkcii.
#
# Supabase URL/anon key sa u Vite zapekaju do JS bundlu UZ PRI BUILDE
# (import.meta.env.*), preto sa odovzdavaju ako build ARG - kazde prostredie
# (produkce/develop) potrebuje VLASTNY obraz postaveny s vlastnymi hodnotami,
# nie jeden obraz s premennymi menenymi az pri starte kontajnera.

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_APP_ENV
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
ENV VITE_APP_ENV=${VITE_APP_ENV}

RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O- http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
