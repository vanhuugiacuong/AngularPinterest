// Resolves to whatever host the page itself was loaded from, so the API
// works both from localhost (desktop dev) and from a LAN IP (testing on a
// phone) without hardcoding either — hardcoding one broke the other before.
export const API_BASE_URL = `${window.location.protocol}//${window.location.hostname}:3000`;
