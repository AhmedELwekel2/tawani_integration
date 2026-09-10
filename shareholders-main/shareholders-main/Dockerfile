# Stockholder portal — build the Vite bundle, serve it from nginx.
#
# Vite inlines every VITE_* variable at BUILD time, so they arrive as build args
# rather than runtime env: the same image cannot be repointed at another Supabase
# project without rebuilding. That is why the compose file passes them as `args`,
# not `environment`.

FROM node:20-alpine AS build
WORKDIR /app

# Dependencies first, so a source-only change reuses this layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
# Relative on purpose: the browser calls the agent same-origin and the host nginx
# forwards /tawani/ to it. Keeps CORS out of the picture entirely.
ARG VITE_TAWANI_API_URL=/tawani
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_TAWANI_API_URL=$VITE_TAWANI_API_URL

# pdf.js fetches these at runtime rather than bundling them: cMaps for encoded
# text, and substitute data for standard-14 fonts a PDF references but does not
# embed. Copying them into public/ makes Vite emit them into dist/, so they are
# served as real files instead of being swallowed by the SPA fallback.
RUN mkdir -p public/standard_fonts public/cmaps     && cp -r node_modules/pdfjs-dist/standard_fonts/. public/standard_fonts/     && cp -r node_modules/pdfjs-dist/cmaps/. public/cmaps/

# `npm run build` is `tsc && vite build` — a type error fails the image, by design.
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
