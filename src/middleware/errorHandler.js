/**
 * Express Global Error Handling Middleware
 * Ensures clean, standardized JSON error structure without exposing API keys or stack traces.
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;

  let errorCode = err.code || 'WEATHER_API_ERROR';
  let message = err.message || 'Unable to fetch weather data.';

  // Security check: Remove any accidental key or trace exposure
  if (message.includes('apikey') || message.includes('TOMORROW_API_KEY') || message.includes('key=')) {
    message = 'Authentication issue with weather provider.';
  }

  return res.status(statusCode).json({
    success: false,
    data: null,
    error: {
      code: errorCode,
      message: message
    }
  });
}

module.exports = errorHandler;
