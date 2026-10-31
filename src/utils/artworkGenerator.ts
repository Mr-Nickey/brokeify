/**
 * Generates a high-contrast, resilient SVG data-URI album cover so that
 * every track and MediaSession metadata entry has zero broken images.
 */
export function createAlbumArtworkDataUri(
  title: string,
  artist: string,
  accentHex: string,
  secondaryHex = '#a855f7',
  sourceBadge = 'BROKEIFY'
): string {
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 24);
  const safeArtist = artist
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 26);
  const safeSource = sourceBadge
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .toUpperCase()
    .slice(0, 16);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#09090b"/>
        <stop offset="55%" stop-color="#18181b"/>
        <stop offset="100%" stop-color="${accentHex}" stop-opacity="0.45"/>
      </linearGradient>
      <radialGradient id="glow" cx="75%" cy="25%" r="60%">
        <stop offset="0%" stop-color="${secondaryHex}" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="#09090b" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="400" height="400" fill="url(#g)"/>
    <rect width="400" height="400" fill="url(#glow)"/>
    <circle cx="200" cy="185" r="108" fill="#09090b" stroke="${accentHex}" stroke-width="2.5" stroke-opacity="0.6"/>
    <circle cx="200" cy="185" r="78" fill="none" stroke="#27272a" stroke-width="1.5" stroke-dasharray="8 6"/>
    <circle cx="200" cy="185" r="46" fill="none" stroke="${secondaryHex}" stroke-width="2" stroke-opacity="0.5"/>
    <circle cx="200" cy="185" r="14" fill="${accentHex}"/>
    <text x="32" y="46" fill="${accentHex}" font-family="monospace" font-size="13" font-weight="700" letter-spacing="2">${safeSource}</text>
    <text x="32" y="336" fill="#f4f4f5" font-family="sans-serif" font-size="24" font-weight="700">${safeTitle}</text>
    <text x="32" y="366" fill="#a1a1aa" font-family="sans-serif" font-size="16" font-weight="500">${safeArtist}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
