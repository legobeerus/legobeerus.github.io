FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy the current folder (site root) into the image. The web/ folder lives here.
COPY . /app

# Install dependencies for the server
WORKDIR /app/web
RUN npm install --production

ENV NODE_ENV=production
EXPOSE 3000

# Start the Express server (server.js serves static files from ../legobeerus.github.io)
CMD ["node","server.js"]
