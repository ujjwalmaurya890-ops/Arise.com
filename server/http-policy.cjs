'use strict';

const DEPLOYMENT_SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "base-uri 'self'"
});

// Netlify applies these to every /api/* route. Function-specific headers can
// add CORS, Vary, or a stricter referrer policy without dropping the defaults.
const API_SECURITY_HEADERS = Object.freeze({
  ...DEPLOYMENT_SECURITY_HEADERS,
  'Cache-Control': 'no-store, private'
});

function cacheControlFor(urlPath) {
  const pathname = typeof urlPath === 'string' ? urlPath.split('?')[0] : '/';
  if (pathname === '/' || pathname === '/index.html' || pathname === '/service-worker.js') {
    return 'no-cache, no-store, must-revalidate';
  }
  // The authentication entry is security-sensitive and intentionally follows
  // the explicit Netlify rule even on the local production-like server.
  if (pathname === '/404.html') return 'no-store';
  if (pathname === '/manifest.webmanifest') return 'no-cache, must-revalidate';
  if (pathname.startsWith('/assets/') && pathname.endsWith('.json')) return 'public, max-age=60, must-revalidate';
  if (pathname === '/assets/cloud-auth.js') return 'no-cache, must-revalidate';
  if (pathname.startsWith('/assets/chunks/') || pathname.startsWith('/assets/fonts/') || pathname.startsWith('/assets/sounds/')) {
    return 'public, max-age=31536000, immutable';
  }
  // Unhashed source, app bundles and styles must revalidate shortly after a
  // deployment; otherwise a browser can keep an old fixed-name bundle for a year.
  if (pathname.startsWith('/src/') || pathname.startsWith('/styles/') || /\.(?:js|css)$/.test(pathname)) {
    return 'public, max-age=60, must-revalidate';
  }
  return 'public, max-age=31536000, stale-while-revalidate=86400';
}

// HTTP header names are case-insensitive. Normalize them while merging so a
// function's lower-case `content-type` cannot coexist with an upper-case copy.
function mergeHeaders(...sets) {
  const headers = new Map();
  for (const set of sets) {
    for (const [name, value] of Object.entries(set || {})) {
      headers.set(name.toLowerCase(), { name, value });
    }
  }
  return Object.fromEntries([...headers.values()].map(({ name, value }) => [name, value]));
}

module.exports = { DEPLOYMENT_SECURITY_HEADERS, API_SECURITY_HEADERS, cacheControlFor, mergeHeaders };
