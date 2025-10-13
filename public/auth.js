const STORAGE_KEYS = {
  managerToken: "calltime.managerToken",
  clientToken: "calltime.clientToken",
  clientId: "calltime.clientId",
  clientName: "calltime.clientName",
};

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

const shouldBypassCache = (options = {}) => {
  const method = options.method ? String(options.method).toUpperCase() : "GET";
  return method === "GET";
};

const withCacheBuster = (url, options = {}) => {
  if (typeof url !== "string" || !shouldBypassCache(options)) {
    return url;
  }

  const [base, hash] = url.split("#");
  const separator = base.includes("?") ? "&" : "?";
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const cacheSafeUrl = `${base}${separator}__nc=${token}`;
  return hash ? `${cacheSafeUrl}#${hash}` : cacheSafeUrl;
};

const buildOptions = (token, options = {}) => {
  const merged = { cache: "no-store", ...options };
  merged.headers = {
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  return merged;
};

const handleUnauthorized = (response) => {
  return response.status === 401 || response.status === 403;
};

const fetchWithToken = async (token, url, options, onUnauthorized) => {
  if (!token) {
    throw new UnauthorizedError();
  }
  const requestUrl = withCacheBuster(url, options);
  const response = await fetch(requestUrl, buildOptions(token, options));
  if (handleUnauthorized(response)) {
    onUnauthorized?.();
    throw new UnauthorizedError();
  }
  return response;
};

// Manager helpers
export const getManagerToken = () => localStorage.getItem(STORAGE_KEYS.managerToken);

export const setManagerToken = (token) => {
  if (token) {
    localStorage.setItem(STORAGE_KEYS.managerToken, token);
  }
};

export const clearManagerSession = () => {
  localStorage.removeItem(STORAGE_KEYS.managerToken);
};

export const managerFetch = (url, options) =>
  fetchWithToken(getManagerToken(), url, options, clearManagerSession);

// Client helpers
export const getClientSession = () => ({
  token: localStorage.getItem(STORAGE_KEYS.clientToken),
  clientId: localStorage.getItem(STORAGE_KEYS.clientId),
  clientName: localStorage.getItem(STORAGE_KEYS.clientName),
});

export const setClientSession = ({ token, clientId, clientName }) => {
  if (token) {
    localStorage.setItem(STORAGE_KEYS.clientToken, token);
  }
  if (clientId !== undefined && clientId !== null) {
    localStorage.setItem(STORAGE_KEYS.clientId, String(clientId));
  }
  if (clientName) {
    localStorage.setItem(STORAGE_KEYS.clientName, clientName);
  }
};

export const clearClientSession = () => {
  localStorage.removeItem(STORAGE_KEYS.clientToken);
  localStorage.removeItem(STORAGE_KEYS.clientId);
  localStorage.removeItem(STORAGE_KEYS.clientName);
};

export const clientFetch = (url, options) =>
  fetchWithToken(getClientSession().token, url, options, clearClientSession);
