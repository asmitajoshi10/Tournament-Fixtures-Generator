// ./config/redis.js
const redis = require('redis');
require('dotenv').config(); // Makes sure your app reads the .env file

// Pass the cloud URL from your .env file straight to the Redis client
const redisClient = redis.createClient({
    url: process.env.REDIS_URL
});

redisClient.on('error', (err) => {
    console.error('❌ Redis Client Error:', err);
});

redisClient.on('connect', () => {
    console.log('🚀 Redis Cloud Engine Connected Successfully!');
});

// Connect to the cloud database asynchronously
(async () => {
    try {
        await redisClient.connect();
    } catch (err) {
        console.error('Could not connect to Redis Cloud:', err);
    }
})();

module.exports = redisClient;