async function parseJsonResponse(response) {
  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message =
      data?.error ||
      data?.message ||
      text ||
      `${response.status} ${response.statusText}`;
    throw new Error(String(message).trim());
  }

  return data;
}

function buildUrl(base, path) {
  if (!base) return path;
  return `${String(base).replace(/\/+$/, "")}${path}`;
}

export async function apiGetProducts(routeApiBase = "") {
  const response = await fetch(buildUrl(routeApiBase, "/api/products"));
  return parseJsonResponse(response);
}

export async function apiSearchSupply(payload, signal, routeApiBase = "") {
  const response = await fetch(buildUrl(routeApiBase, "/api/supply/search"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  return parseJsonResponse(response);
}

export async function apiBuildNotebookLmPrompt(payload, routeApiBase = "") {
  const response = await fetch(buildUrl(routeApiBase, "/api/notebooklm/prompt"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse(response);
}

export async function apiGetNotebookLmStatus(routeApiBase = "") {
  const response = await fetch(buildUrl(routeApiBase, "/api/notebooklm/status"));
  return parseJsonResponse(response);
}

export async function apiQueryNotebookLm(payload, signal, routeApiBase = "") {
  const response = await fetch(buildUrl(routeApiBase, "/api/notebooklm/query"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  return parseJsonResponse(response);
}

export async function apiSearchRecommendations(payload, signal, routeApiBase = "") {
  const response = await fetch(buildUrl(routeApiBase, "/api/recommendations/search"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  return parseJsonResponse(response);
}
