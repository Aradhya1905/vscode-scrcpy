/**
 * Utility functions for color manipulation
 */

/**
 * Converts hex color to RGB values
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? {
              r: parseInt(result[1], 16),
              g: parseInt(result[2], 16),
              b: parseInt(result[3], 16),
          }
        : null;
}

/**
 * Converts RGB values to hex color
 */
function rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Generates a darker version of a color by reducing brightness
 * @param color - Hex color string (e.g., "#1a1a1a")
 * @param factor - Darkening factor (0-1), default 0.4 (40% darker)
 * @returns Darker hex color string
 */
export function darkenColor(color: string, factor: number = 0.4): string {
    // Handle hex colors
    if (color.startsWith('#')) {
        const rgb = hexToRgb(color);
        if (!rgb) return color;

        const darkerR = Math.max(0, Math.round(rgb.r * (1 - factor)));
        const darkerG = Math.max(0, Math.round(rgb.g * (1 - factor)));
        const darkerB = Math.max(0, Math.round(rgb.b * (1 - factor)));

        return rgbToHex(darkerR, darkerG, darkerB);
    }

    // Handle rgba colors - extract RGB and darken
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbaMatch) {
        const r = parseInt(rgbaMatch[1]);
        const g = parseInt(rgbaMatch[2]);
        const b = parseInt(rgbaMatch[3]);
        const a = rgbaMatch[0].includes('rgba') ? color.match(/,\s*([\d.]+)\)/)?.[1] || '1' : '1';

        const darkerR = Math.max(0, Math.round(r * (1 - factor)));
        const darkerG = Math.max(0, Math.round(g * (1 - factor)));
        const darkerB = Math.max(0, Math.round(b * (1 - factor)));

        return `rgba(${darkerR}, ${darkerG}, ${darkerB}, ${a})`;
    }

    // Return original if we can't parse it
    return color;
}
