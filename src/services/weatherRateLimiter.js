const { getEnvConfig } = require('../config/env');

/**
 * Shared Process-Wide Weather Rate Limiter & Concurrency Controller
 * Enforces hourly provider quota, concurrency limits, 429 cooldowns, and priority queueing.
 */

class WeatherRateLimiter {
  constructor() {
    const config = getEnvConfig();
    this.maxRequestsPerHour = config.tomorrowRateLimitPerHour;
    this.windowMs = config.tomorrowRateLimitWindowMinutes * 60 * 1000;
    this.concurrencyLimit = config.weatherConcurrency;

    this.requestTimestamps = []; // Array of ms timestamps
    this.cooldownUntil = 0;      // Timestamp ms
    this.activeRequests = 0;
    this.queue = [];             // Array of { taskFn, priority, resolve, reject }
  }

  /**
   * Re-evaluates configuration (useful when env settings change in tests)
   */
  reloadConfig() {
    const config = getEnvConfig();
    this.maxRequestsPerHour = config.tomorrowRateLimitPerHour;
    this.windowMs = config.tomorrowRateLimitWindowMinutes * 60 * 1000;
    this.concurrencyLimit = config.weatherConcurrency;
  }

  /**
   * Cleans old timestamps outside sliding window
   */
  pruneTimestamps() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    this.requestTimestamps = this.requestTimestamps.filter(t => t > cutoff);
  }

  /**
   * Checks if process is currently under HTTP 429 cooldown
   */
  isCoolingDown() {
    return Date.now() < this.cooldownUntil;
  }

  /**
   * Trigger HTTP 429 rate-limit cooldown
   */
  trigger429Cooldown(retryAfterSeconds = 60) {
    const cooldownMs = Math.max(10, Number(retryAfterSeconds) || 60) * 1000;
    this.cooldownUntil = Date.now() + cooldownMs;
    console.warn(`[Tomorrow RateLimiter] 429 Cooldown activated for ${Math.round(cooldownMs / 1000)}s`);
  }

  /**
   * Checks if process has available hourly quota
   */
  hasQuota() {
    this.pruneTimestamps();
    return this.requestTimestamps.length < this.maxRequestsPerHour;
  }

  /**
   * Schedules an async provider call with concurrency control and rate limiting.
   * Priority: 'HIGH' (Interactive requests) vs 'LOW' (Background revalidation)
   */
  schedule(taskFn, priority = 'HIGH') {
    return new Promise((resolve, reject) => {
      this.queue.push({ taskFn, priority, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Processes queued provider tasks
   */
  async processQueue() {
    if (this.queue.length === 0) return;
    if (this.activeRequests >= this.concurrencyLimit) return;
    if (this.isCoolingDown()) {
      // Reject low priority background tasks during 429 cooldown
      const lowPriorityIndex = this.queue.findIndex(q => q.priority === 'LOW');
      if (lowPriorityIndex !== -1) {
        const item = this.queue.splice(lowPriorityIndex, 1)[0];
        return item.reject(new Error('WEATHER_PROVIDER_COOLDOWN'));
      }
      return;
    }

    if (!this.hasQuota()) {
      // Quota exhausted -> reject queued low priority tasks
      const lowPriorityIndex = this.queue.findIndex(q => q.priority === 'LOW');
      if (lowPriorityIndex !== -1) {
        const item = this.queue.splice(lowPriorityIndex, 1)[0];
        return item.reject(new Error('WEATHER_PROVIDER_QUOTA_EXHAUSTED'));
      }
      return;
    }

    // Sort queue: HIGH priority first
    this.queue.sort((a, b) => (a.priority === 'HIGH' ? -1 : 1));
    const nextTask = this.queue.shift();
    if (!nextTask) return;

    this.activeRequests++;
    this.requestTimestamps.push(Date.now());

    try {
      const result = await nextTask.taskFn();
      nextTask.resolve(result);
    } catch (err) {
      nextTask.reject(err);
    } finally {
      this.activeRequests--;
      setImmediate(() => this.processQueue());
    }
  }

  /**
   * Clears state (useful for unit tests)
   */
  reset() {
    this.requestTimestamps = [];
    this.cooldownUntil = 0;
    this.activeRequests = 0;
    this.queue = [];
  }
}

const rateLimiterInstance = new WeatherRateLimiter();
module.exports = rateLimiterInstance;