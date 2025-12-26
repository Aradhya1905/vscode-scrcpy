/**
 * UI Constants
 * Centralized constants for UI components
 */

/**
 * Icon size for toolbar icons (in pixels)
 * Increase this value to make toolbar icons larger
 */
export const TOOLBAR_ICON_SIZE = 18;

/**
 * Scroll sensitivity for mouse wheel in the mirrored view.
 * Lower values make scrolling slower and more controlled.
 * Formula: scale = SCROLL_WHEEL_SCALE / SCROLL_WHEEL_DIVISOR
 * Recommended range: SCROLL_WHEEL_SCALE between 1-10, SCROLL_WHEEL_DIVISOR between 10-50
 * Example: 5 / 20 = 0.25x scaling (smooth and controlled)
 */
export const SCROLL_WHEEL_SCALE = 10;

/**
 * Divisor for scroll wheel scaling calculation.
 * Higher values make scrolling slower overall. Lower values make it faster.
 * Formula: scale = SCROLL_WHEEL_SCALE / SCROLL_WHEEL_DIVISOR
 * Example: With SCROLL_WHEEL_SCALE = 5 and SCROLL_WHEEL_DIVISOR = 20,
 * each wheel tick is scaled to 25% of its original value for smooth scrolling.
 */
export const SCROLL_WHEEL_DIVISOR = 2;

/**
 * Background gradient for the video container.
 * Change this value to customize the background gradient.
 * Format: CSS gradient string (radial-gradient, linear-gradient, etc.)
 *
 * Examples:
 * - radial-gradient(circle, rgba(238, 174, 202, 1) 0%, rgba(148, 187, 233, 1) 100%)
 * - linear-gradient(135deg, #667eea 0%, #764ba2 100%)
 * - linear-gradient(to right, #f093fb 0%, #f5576c 100%)
 */
// export const VIDEO_CONTAINER_BACKGROUND_GRADIENT =
//   "radial-gradient(circle, rgba(238, 174, 202, 1) 0%, rgba(148, 187, 233, 1) 100%)";

/*
 * Created with https://www.css-gradient.com
 * Gradient link: https://www.css-gradient.com/?c1=010101&c2=0f0b06&gt=l&gd=dtl
 * DARK TO LIGHT GRADIENT
 */
// export const VIDEO_CONTAINER_BACKGROUND_GRADIENT =
//   "linear-gradient(315deg, rgba(1, 1, 1, 1.0), rgba(15, 11, 6, 1.0))";

/*
 * Created with https://www.css-gradient.com
 * Gradient link: https://www.css-gradient.com/?c1=010101&c2=010101&gt=l&gd=dtl
 * FULL BLACK GRADIENT
 */

export const VIDEO_CONTAINER_BACKGROUND_GRADIENT =
    'linear-gradient(315deg, rgba(1, 1, 1, 1.0), rgba(1, 1, 1, 1.0))';
