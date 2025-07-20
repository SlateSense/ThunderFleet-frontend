// Performance optimization utilities

// Debounce function to limit how often expensive operations can run
export const debounce = (func, wait, immediate) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      timeout = null;
      if (!immediate) func(...args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func(...args);
  };
};

// Throttle function to limit function calls to once per interval
export const throttle = (func, limit) => {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

// Optimized RAF-based animation frame scheduler
export const scheduleWork = (() => {
  const callbacks = [];
  let isScheduled = false;

  const flushWork = () => {
    isScheduled = false;
    const currentCallbacks = callbacks.splice(0, callbacks.length);
    currentCallbacks.forEach(callback => callback());
  };

  return (callback) => {
    callbacks.push(callback);
    if (!isScheduled) {
      isScheduled = true;
      requestAnimationFrame(flushWork);
    }
  };
})();

// Memory-efficient object pool for game entities
export class ObjectPool {
  constructor(createFn, resetFn, initialSize = 10) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.pool = [];
    
    // Pre-populate the pool
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.createFn());
    }
  }

  get() {
    if (this.pool.length > 0) {
      return this.pool.pop();
    }
    return this.createFn();
  }

  release(obj) {
    if (this.resetFn) {
      this.resetFn(obj);
    }
    this.pool.push(obj);
  }
}

// Performance monitor for tracking FPS and render time
export class PerformanceMonitor {
  constructor() {
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.fps = 60;
    this.renderTimes = [];
  }

  startFrame() {
    this.frameStartTime = performance.now();
  }

  endFrame() {
    const now = performance.now();
    const renderTime = now - this.frameStartTime;
    
    this.renderTimes.push(renderTime);
    if (this.renderTimes.length > 60) {
      this.renderTimes.shift();
    }

    this.frameCount++;
    const deltaTime = now - this.lastTime;
    
    if (deltaTime >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / deltaTime);
      this.frameCount = 0;
      this.lastTime = now;
    }
  }

  getFPS() {
    return this.fps;
  }

  getAverageRenderTime() {
    if (this.renderTimes.length === 0) return 0;
    const sum = this.renderTimes.reduce((a, b) => a + b, 0);
    return sum / this.renderTimes.length;
  }

  isPerformancePoor() {
    return this.fps < 30 || this.getAverageRenderTime() > 16.67; // 60 FPS target
  }
}

// Lazy loading utility for heavy resources
export const createLazyLoader = () => {
  const loadedResources = new Map();
  const loadingResources = new Map();

  return {
    async load(key, loadFn) {
      if (loadedResources.has(key)) {
        return loadedResources.get(key);
      }

      if (loadingResources.has(key)) {
        return loadingResources.get(key);
      }

      const promise = loadFn().then(resource => {
        loadedResources.set(key, resource);
        loadingResources.delete(key);
        return resource;
      }).catch(error => {
        loadingResources.delete(key);
        throw error;
      });

      loadingResources.set(key, promise);
      return promise;
    },

    get(key) {
      return loadedResources.get(key);
    },

    has(key) {
      return loadedResources.has(key);
    },

    clear() {
      loadedResources.clear();
      loadingResources.clear();
    }
  };
};

// Optimized event batching for multiple state updates
export class EventBatcher {
  constructor() {
    this.batches = new Map();
    this.isScheduled = false;
  }

  batch(key, fn) {
    if (!this.batches.has(key)) {
      this.batches.set(key, []);
    }
    this.batches.get(key).push(fn);
    
    if (!this.isScheduled) {
      this.isScheduled = true;
      scheduleWork(() => this.flush());
    }
  }

  flush() {
    this.isScheduled = false;
    for (const [key, fns] of this.batches) {
      // Execute all batched functions for this key
      fns.forEach(fn => fn());
    }
    this.batches.clear();
  }
}
