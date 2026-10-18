/**
 * Reconstructs a Tidal album cover UUID into a direct Tidal CDN image URL.
 * UUID format: "4e73f2aa-a392-4217-9150-14e4b4764834"
 * Output: "https://resources.tidal.com/images/4e73f2aa/a392/4217/9150/14e4b4764834/640x640.jpg"
 */
export function formatCoverUrl(coverUuid?: string | null): string | null {
  if (!coverUuid || typeof coverUuid !== 'string' || coverUuid.trim() === '') {
    return null;
  }
  const path = coverUuid.trim().replace(/-/g, '/');
  return `https://resources.tidal.com/images/${path}/640x640.jpg`;
}
