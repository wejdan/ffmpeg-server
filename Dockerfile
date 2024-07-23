# Use the official Node.js image
FROM node:14

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Set the working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Set environment variables
ENV PORT=3000
ENV FFMPEG_PATH=/usr/bin/ffmpeg

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "app.js"]
