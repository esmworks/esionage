/**
 * Fired on `window` to open the Share panel of a page (`detail.pageId`) that is open in the
 * header. A listener that opens it cancels the event, so the sender can tell nobody did (a
 * database shown inside another page) and go to the page with `?share=1` instead.
 */
export const OPEN_SHARE_EVENT = "leafdesk:open-share";

/** Asks the header to open `pageId`'s Share panel; false when no header showing that page did. */
export function openSharePanel(pageId: string): boolean {
  return !window.dispatchEvent(new CustomEvent(OPEN_SHARE_EVENT, { detail: { pageId }, cancelable: true }));
}
