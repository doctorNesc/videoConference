FROM node:22 AS build

WORKDIR /src

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
# RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build src/dist/client-app/browser /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
