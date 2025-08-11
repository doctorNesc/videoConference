FROM node:22

WORKDIR /src

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build --configuration production

FROM nginx:alpine
COPY --from=builder /client-app/dist/client-app/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
