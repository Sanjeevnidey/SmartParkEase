// Set VITE_API_BASE_URL at build time (e.g. https://<api-id>.execute-api.<region>.amazonaws.com/api
// or https://<service>.onrender.com/api). In development it defaults to the local API.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:4001/api' : '/api');

export async function apiRequest(path, options = {}) {
  const token = localStorage.getItem('pe_token');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && token) {
    // Expired or revoked session: forget it so the UI shows the signed-out state.
    localStorage.removeItem('pe_token');
    localStorage.removeItem('pe_user');
    window.dispatchEvent(new Event('parkease-signed-out'));
  }
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
  return data;
}
