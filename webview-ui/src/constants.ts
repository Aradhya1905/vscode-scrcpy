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
export const SCROLL_WHEEL_SCALE = 20;

/**
 * Divisor for scroll wheel scaling calculation.
 * Higher values make scrolling slower overall. Lower values make it faster.
 * Formula: scale = SCROLL_WHEEL_SCALE / SCROLL_WHEEL_DIVISOR
 * Example: With SCROLL_WHEEL_SCALE = 5 and SCROLL_WHEEL_DIVISOR = 20,
 * each wheel tick is scaled to 25% of its original value for smooth scrolling.
 */
export const SCROLL_WHEEL_DIVISOR = 2;

/*
 * The video container backdrop used to be declared here and was never imported
 * by anything. It now lives in the token layer as --backdrop-default
 * (webview-ui/src/styles/tokens.css), derived from --accent and --surface so it
 * follows the VS Code theme, and a saved gradientColor1/gradientColor2 pair
 * still overrides it. See docs/changes/06-state-surfaces.md
 */
