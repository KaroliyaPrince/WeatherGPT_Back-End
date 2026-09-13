const express = require('express');
const router = express.Router();
const { getRouteWeather } = require('../controllers/routeWeatherController');

// GET /api/route-weather?source=Morbi&destination=Ahmedabad
router.get('/', getRouteWeather);

module.exports = router;
