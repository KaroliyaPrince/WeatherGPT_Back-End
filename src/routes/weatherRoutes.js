const express = require('express');
const router = express.Router();
const {
  getMainWeather,
  getCurrentWeather,
  getHourlyForecast,
  getDailyForecast,
  getWeatherAlerts,
  getHistoricalWeather,
  searchCitiesController
} = require('../controllers/weatherController');

// GET /api/weather (Main consolidated weather endpoint)
router.get('/', getMainWeather);

// GET /api/weather/search (City search & autocompletion)
router.get('/search', searchCitiesController);

// GET /api/weather/current (Current weather)
router.get('/current', getCurrentWeather);

// GET /api/weather/hourly (Hourly forecast - next 24h)
router.get('/hourly', getHourlyForecast);

// GET /api/weather/daily (Daily forecast)
router.get('/daily', getDailyForecast);

// GET /api/weather/alerts (Weather alerts)
router.get('/alerts', getWeatherAlerts);

// GET /api/weather/history (Last 7 days completed history)
router.get('/history', getHistoricalWeather);

module.exports = router;
