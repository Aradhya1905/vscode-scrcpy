/**
 * Writes a PNG to the system clipboard from the webview.
 *
 * The extension host cannot do this itself - `vscode.env.clipboard` is text-only -
 * so the captured image is posted here and written through the webview's Chromium
 * clipboard instead. `navigator.clipboard.write` requires the document to be
 * focused, which holds: the write is a reply to a message the user's own toolbar
 * click started, and the webview keeps focus across the round trip.
 */
export async function copyPngToClipboard(png: ArrayBuffer): Promise<void> {
    const blob = new Blob([png], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
