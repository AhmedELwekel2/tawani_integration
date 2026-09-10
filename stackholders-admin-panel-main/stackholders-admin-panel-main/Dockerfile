# Admin panel — build the Vite bundle, serve it from nginx.
#
# As with the portal, VITE_* values are inlined at BUILD time and so arrive as
# build args. See the note on VITE_TAWANI_ADMIN_KEY below before setting it.

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# --legacy-peer-deps is required, not incidental: package.json pins
# esbuild ^0.28 while Vite 8 declares a peerOptional on esbuild ^0.27, and a
# plain `npm ci` aborts on that conflict.
RUN npm ci --legacy-peer-deps

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_TAWANI_API_URL=/tawani
# WARNING: anything VITE_* is compiled into the public JS bundle and is readable
# by anyone who loads the admin panel, signed in or not. Leave this EMPTY unless
# you accept that the agent's generate/publish endpoints are effectively open,
# and restrict them at the nginx layer instead (see deploy/nginx/).
ARG VITE_TAWANI_ADMIN_KEY=
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_TAWANI_API_URL=$VITE_TAWANI_API_URL \
    VITE_TAWANI_ADMIN_KEY=$VITE_TAWANI_ADMIN_KEY

RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
