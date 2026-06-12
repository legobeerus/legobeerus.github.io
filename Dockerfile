FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy server and static site folders into the image
COPY web ./web
COPY legobeerus.github.io ./legobeerus.github.io

# Install dependencies for the server
WORKDIR /app/web
RUN npm install --production

ENV NODE_ENV=production
EXPOSE 3000

# Start the Express server (server.js uses ../legobeerus.github.io as static root)
CMD ["node","server.js"]
