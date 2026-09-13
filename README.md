# WeatherGPT Backend REST API

> **Conversational AI for Weather Forecasting, Alerts, and Climate Information**  
> Smart India Hackathon (SIH) Project Backend

A clean, modern, frontend-independent Express.js REST API backend powered by the live **Tomorrow.io Weather API v4**. Designed specifically to serve multiple clients seamlessly, including web apps (React, Next.js), mobile applications (Flutter, React Native), and third-party integrations.

---

## 🌟 Key Features

- **Tomorrow.io API v4 Live Integration**: Fetches real-time, hourly, and multi-day daily weather data without mock/hardcoded values.
- **Frontend-Agnostic REST Architecture**: Standardized JSON responses with `snake_case` keys consumable by any web or mobile client.
- **Flexible Location Lookup**: Supports location search by city name (`?city=Rajkot`) or geographic coordinates (`?lat=22.3039&lon=70.8022`).
- **Comprehensive Weather Metrics**:
  - Temperature, Apparent Feels-Like, High/Low/Avg temperatures (°C)
  - Wind speed & wind gust auto-converted from m/s to km/h (`wind_kph`, `wind_gust_kph`)
  - Wind direction (degrees)
  - Surface pressure (hPa / mb)
  - Visibility (km)
  - Cloud cover (%)
  - UV index
  - Humidity (%)
  - Precipitation probability (%) and intensity/accumulation (mm)
  - Daily astronomical data (Sunrise & Sunset times)
  - Weather condition mappings with text descriptions and icon keys
- **"Weather Along My Journey" / Route Weather**: Computes actual driving road geometry via **OpenRouteService**, dynamically reverse-geocodes intermediate cities/towns, fetches travel-time-aware weather from **Tomorrow.io**, and generates route safety warnings.
- **Strict Null Safety**: Unsupplied weather fields from provider return explicit `null` values instead of artificial zeroes or fake fallbacks.
- **Secure Key Isolation**: Keeps `TOMORROW_API_KEY` hidden on the backend; never exposes API credentials or error stack traces to clients.
- **CORS & Security Configured**: Includes `cors` and `helmet` for cross-origin security.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v16.x or higher
- **npm**: v8.x or higher
- **Tomorrow.io API Key**: Get a free API key from [Tomorrow.io Developer Portal](https://www.tomorrow.io/development-api/)

### Installation

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create or update your `.env` file in the `backend/` root directory:
   ```env
   PORT=5000
   TOMORROW_API_KEY=PYEHQaw5E6nHel6n8wBhwNdVmkG8XSUY
   CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
   ```

### Running the Server

- **Development Mode (with auto-reload)**:
  ```bash
  npm run dev
  ```

- **Production Mode**:
  ```bash
  npm start
  ```

Once running, the backend will listen on `http://localhost:5000`.

---

## 📡 API Endpoints

### 1. Health Check
Checks backend service availability.

- **Endpoint**: `GET /api/health`
- **Query Parameters**: None
- **Response**:
  ```json
  {
    "success": true,
    "message": "WeatherGPT backend is running"
  }
  ```

---

### 2. Main Consolidated Weather
Retrieves location metadata, current weather, hourly forecast (~24h), daily forecast (multi-day), and active alerts in a single API call.

- **Endpoint**: `GET /api/weather`
- **Query Parameters**:
  | Parameter | Type | Required | Description | Example |
  | :--- | :--- | :--- | :--- | :--- |
  | `city` | `string` | Optional* | City name | `Rajkot` |
  | `lat` | `number` | Optional* | Latitude (-90 to 90) | `22.3039` |
  | `lon` | `number` | Optional* | Longitude (-180 to 180) | `70.8022` |

  *\*Either `city` OR both `lat` and `lon` are required.*

- **Example Requests**:
  ```bash
  curl "http://localhost:5000/api/weather?city=Rajkot"
  curl "http://localhost:5000/api/weather?lat=22.3039&lon=70.8022"
  ```

- **Response Example**:
  ```json
  {
    "success": true,
    "source": "Tomorrow.io",
    "location": {
      "name": "Rajkot",
      "latitude": 22.3053,
      "longitude": 70.8028
    },
    "current": {
      "temperature_c": 28,
      "feels_like_c": 30.6,
      "humidity": 69,
      "wind_kph": 8.6,
      "wind_direction": 280,
      "wind_gust_kph": 17.6,
      "pressure_mb": 994,
      "visibility_km": 16,
      "cloud_cover": 42,
      "uv_index": 0,
      "precipitation_probability": 0,
      "precipitation_intensity": 0,
      "rain_accumulation_mm": null,
      "condition": {
        "text": "Partly Cloudy",
        "icon": "cloud-sun",
        "code": 1101
      }
    },
    "hourly": [
      {
        "time": "2026-09-11T17:00:00Z",
        "temperature_c": 27.5,
        "feels_like_c": 29.8,
        "humidity": 72,
        "wind_kph": 9.2,
        "wind_direction": 275,
        "wind_gust_kph": 18.1,
        "pressure_mb": 995,
        "visibility_km": 16,
        "cloud_cover": 38,
        "uv_index": 0,
        "precipitation_probability": 0,
        "precipitation_intensity": 0,
        "rain_accumulation_mm": null,
        "condition": {
          "text": "Partly Cloudy",
          "icon": "cloud-sun",
          "code": 1101
        }
      }
    ],
    "daily": [
      {
        "date": "2026-09-11",
        "temperature_max_c": 35.6,
        "temperature_min_c": 24.1,
        "temperature_avg_c": 26.5,
        "precipitation_probability": 0,
        "precipitation_mm": 0,
        "wind_kph": 7.9,
        "wind_gust_kph": 16.9,
        "wind_direction": 276,
        "cloud_cover": 66,
        "humidity": 82,
        "uv_index": 9,
        "sunrise": "2026-09-11T01:02:00Z",
        "sunset": "2026-09-11T13:25:00Z",
        "condition": {
          "text": "Cloudy",
          "icon": "cloud",
          "code": 1001
        }
      }
    ],
    "alerts": [],
    "metadata": {
      "units": "metric",
      "updated_at": "2026-09-11T16:50:00Z"
    }
  }
  ```

---

### 3. Current Weather
Retrieves real-time weather metrics for a location.

- **Endpoint**: `GET /api/weather/current`
- **Example**:
  ```bash
  curl "http://localhost:5000/api/weather/current?city=Rajkot"
  ```

---

### 4. Hourly Forecast
Retrieves upcoming 24-hour weather timeline.

- **Endpoint**: `GET /api/weather/hourly`
- **Example**:
  ```bash
  curl "http://localhost:5000/api/weather/hourly?city=Rajkot"
  ```

---

### 5. Daily Forecast
Retrieves multi-day daily weather summary forecast.

- **Endpoint**: `GET /api/weather/daily`
- **Example**:
  ```bash
  curl "http://localhost:5000/api/weather/daily?city=Rajkot"
  ```

---

### 6. Weather Alerts
Retrieves severe weather warnings or alerts if reported by provider.

- **Endpoint**: `GET /api/weather/alerts`
- **Example**:
  ```bash
  curl "http://localhost:5000/api/weather/alerts?city=Rajkot"
  ```

---

## ❌ Error Responses

All API errors return consistent JSON structures with appropriate HTTP status codes:

### 400 Bad Request (Missing / Invalid Location)
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INVALID_LOCATION",
    "message": "Please provide a valid city or latitude and longitude."
  }
}
```

### 401 Unauthorized (Invalid API Key)
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INVALID_API_KEY",
    "message": "Tomorrow.io API key is invalid or unauthorized."
  }
}
```

### 429 Too Many Requests (Rate Limit Exceeded)
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Tomorrow.io API rate limit exceeded. Please try again later."
  }
}
```

---

## 📁 Project Structure

```
backend/
├── .env                      # API keys and environment configuration
├── package.json              # Express, Axios, CORS, Helmet dependencies
├── server.js                 # Server entry point
└── src/
    ├── app.js                # Express app initialization, middleware, routes
    ├── controllers/
    │   └── weatherController.js # Metric normalization, query extraction, endpoints
    ├── middleware/
    │   └── errorHandler.js   # Global sanitized JSON error handler
    ├── routes/
    │   └── weatherRoutes.js   # API route definitions
    ├── services/
    │   └── tomorrowService.js# Tomorrow.io API v4 Axios client
    └── utils/
        └── weatherMapper.js  # Weather code to condition & icon mapper
```

---

## 📜 License

ISC License - Developed for Smart India Hackathon (SIH).
