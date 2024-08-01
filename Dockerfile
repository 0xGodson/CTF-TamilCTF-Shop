FROM node:latest

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies and rebuild sqlite3
RUN npm install && npm rebuild sqlite3 --build-from-source

# Copy the rest of the application code
COPY . .

# Expose the port
EXPOSE 3000

# Command to run the application
CMD ["npm", "start"]
