/**
 * Grid Metrics Utility
 * 
 * Provides exact grid measurements and cell size calculations using
 * getComputedStyle and getBoundingClientRect for accurate measurements
 * that account for borders, padding, and actual rendered dimensions.
 */

// Debounce utility for resize events
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Calculate exact grid metrics from a grid reference
 * @param {HTMLElement} gridRef - The grid DOM element
 * @returns {Object} Grid metrics object
 */
export function getGridMetrics(gridRef) {
  if (!gridRef) {
    throw new Error('Grid reference is required');
  }

  const rect = gridRef.getBoundingClientRect();
  const computedStyle = getComputedStyle(gridRef);
  
  // Extract border widths
  const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
  const borderRight = parseFloat(computedStyle.borderRightWidth) || 0;
  const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;
  const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;
  
  // Extract padding
  const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
  const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
  const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
  const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
  
  // Calculate total border and padding thickness
  const totalBorderWidth = borderLeft + borderRight;
  const totalBorderHeight = borderTop + borderBottom;
  const totalPaddingWidth = paddingLeft + paddingRight;
  const totalPaddingHeight = paddingTop + paddingBottom;
  
  // Calculate usable (content) dimensions
  const usableWidth = rect.width - totalBorderWidth - totalPaddingWidth;
  const usableHeight = rect.height - totalBorderHeight - totalPaddingHeight;
  
  return {
    // Raw dimensions
    totalWidth: rect.width,
    totalHeight: rect.height,
    
    // Usable dimensions (content area)
    usableWidth,
    usableHeight,
    
    // Border thickness
    borderThickness: {
      top: borderTop,
      right: borderRight,
      bottom: borderBottom,
      left: borderLeft,
      totalWidth: totalBorderWidth,
      totalHeight: totalBorderHeight
    },
    
    // Padding thickness
    paddingThickness: {
      top: paddingTop,
      right: paddingRight,
      bottom: paddingBottom,
      left: paddingLeft,
      totalWidth: totalPaddingWidth,
      totalHeight: totalPaddingHeight
    },
    
    // Combined outer thickness (borders + padding)
    outerThickness: {
      totalWidth: totalBorderWidth + totalPaddingWidth,
      totalHeight: totalBorderHeight + totalPaddingHeight
    }
  };
}

/**
 * Calculate cell size based on grid metrics and grid dimensions
 * @param {HTMLElement} gridRef - The grid DOM element
 * @param {number} cols - Number of columns
 * @param {number} rows - Number of rows
 * @returns {Object} Cell size information
 */
export function calcCellSize(gridRef, cols, rows) {
  if (!gridRef) {
    throw new Error('Grid reference is required');
  }
  
  if (!cols || !rows || cols <= 0 || rows <= 0) {
    throw new Error('Valid column and row counts are required');
  }
  
  const metrics = getGridMetrics(gridRef);
  
  // Calculate cell dimensions
  const cellWidth = metrics.usableWidth / cols;
  const cellHeight = metrics.usableHeight / rows;
  
  // Use the smaller dimension to maintain square cells if needed
  const cellSize = Math.min(cellWidth, cellHeight);
  
  return {
    cellWidth,
    cellHeight,
    cellSize, // Square cell size (minimum of width/height)
    
    // Grid information
    gridCols: cols,
    gridRows: rows,
    
    // Calculated grid dimensions if using square cells
    calculatedGridWidth: cellSize * cols,
    calculatedGridHeight: cellSize * rows,
    
    // Metrics reference
    metrics
  };
}

/**
 * Create a resize listener with debouncing
 * @param {Function} callback - Callback function to execute on resize
 * @param {number} debounceMs - Debounce delay in milliseconds (default: 250)
 * @returns {Function} Cleanup function to remove listeners
 */
export function listenResize(callback, debounceMs = 250) {
  if (typeof callback !== 'function') {
    throw new Error('Callback must be a function');
  }
  
  const debouncedCallback = debounce(callback, debounceMs);
  
  // Listen to both resize and orientation change events
  window.addEventListener('resize', debouncedCallback);
  window.addEventListener('orientationchange', debouncedCallback);
  
  // Return cleanup function
  return () => {
    window.removeEventListener('resize', debouncedCallback);
    window.removeEventListener('orientationchange', debouncedCallback);
  };
}

/**
 * Grid Metrics Manager Class
 * Provides a more comprehensive solution for managing grid metrics
 * with automatic updates and event handling
 */
export class GridMetricsManager {
  constructor(gridRef, cols, rows, options = {}) {
    this.gridRef = gridRef;
    this.cols = cols;
    this.rows = rows;
    this.options = {
      debounceMs: 250,
      autoUpdate: true,
      ...options
    };
    
    this.metrics = null;
    this.cellSize = null;
    this.listeners = [];
    this.cleanupResize = null;
    
    // Initialize metrics
    this.update();
    
    // Set up auto-update if enabled
    if (this.options.autoUpdate) {
      this.enableAutoUpdate();
    }
  }
  
  /**
   * Update grid metrics and cell size calculations
   */
  update() {
    if (!this.gridRef) {
      throw new Error('Grid reference is not available');
    }
    
    this.metrics = getGridMetrics(this.gridRef);
    this.cellSize = calcCellSize(this.gridRef, this.cols, this.rows);
    
    // Notify listeners
    this.listeners.forEach(listener => {
      try {
        listener(this.metrics, this.cellSize);
      } catch (error) {
        console.error('Error in grid metrics listener:', error);
      }
    });
  }
  
  /**
   * Add a listener for metrics updates
   * @param {Function} listener - Callback function
   */
  addListener(listener) {
    if (typeof listener === 'function') {
      this.listeners.push(listener);
    }
  }
  
  /**
   * Remove a listener
   * @param {Function} listener - Callback function to remove
   */
  removeListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }
  
  /**
   * Enable automatic updates on resize/orientation change
   */
  enableAutoUpdate() {
    if (this.cleanupResize) {
      return; // Already enabled
    }
    
    this.cleanupResize = listenResize(() => {
      this.update();
    }, this.options.debounceMs);
  }
  
  /**
   * Disable automatic updates
   */
  disableAutoUpdate() {
    if (this.cleanupResize) {
      this.cleanupResize();
      this.cleanupResize = null;
    }
  }
  
  /**
   * Update grid dimensions (cols/rows)
   * @param {number} cols - New column count
   * @param {number} rows - New row count
   */
  updateDimensions(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.update();
  }
  
  /**
   * Get current metrics
   * @returns {Object} Current grid metrics
   */
  getMetrics() {
    return this.metrics;
  }
  
  /**
   * Get current cell size information
   * @returns {Object} Current cell size data
   */
  getCellSize() {
    return this.cellSize;
  }
  
  /**
   * Cleanup and remove all listeners
   */
  destroy() {
    this.disableAutoUpdate();
    this.listeners = [];
    this.gridRef = null;
    this.metrics = null;
    this.cellSize = null;
  }
}

// Export default object with all utilities
export default {
  getGridMetrics,
  calcCellSize,
  listenResize,
  GridMetricsManager
};
