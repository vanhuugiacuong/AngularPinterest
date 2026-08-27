// Same-origin API base: every caller builds `${API_BASE_URL}/api/...`, so an
// empty base makes those requests relative to whatever host serves the app.
// - Production: the NestJS backend serves both this SPA and /api on the one
//   Railway domain, so `/api/...` hits the backend directly.
// - Dev (`ng serve` on :4200): proxy.conf.json forwards `/api` to the backend
//   on :3000.
// Do NOT hardcode a port here — a fixed `:3000` breaks production, where only
// 443 is exposed.
export const API_BASE_URL = '';
