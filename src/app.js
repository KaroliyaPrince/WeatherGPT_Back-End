const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { validateEnv } = require('./config/env');
const weatherRoutes = require('./routes/weatherRoutes');
const routeWeatherRoutes = require('./routes/routeWeatherRoutes');
const errorHandler = require('./middleware/errorHandler');

// Validate Environment Configuration on Startup
validateEnv();

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration (Environment-based & frontend-agnostic)
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'https://weather-gpt-tau.vercel.app'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. Postman, cURL, Flutter mobile apps, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// 1. Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: "WeatherGPT backend is running"
  });
});

// 2. Weather Routes
app.use('/api/weather', weatherRoutes);

// 3. Route Weather (Weather Along My Journey)
app.use('/api/route-weather', routeWeatherRoutes);

// 4. Global Error Handler
app.use(errorHandler);

module.exports = app;
