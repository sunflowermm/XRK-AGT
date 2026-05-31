export function getApiPriority(api) {
  const priority = Number(api.priority);
  return Number.isFinite(priority) ? priority : 100;
}

export function validateApiInstance(api, key) {
  if (!api.name) api.name = key;
  if (!api.dsc) api.dsc = '';
  api.priority = getApiPriority(api);
  if (api.enable === undefined) api.enable = true;
  if (!Array.isArray(api.routes)) api.routes = [];
  return true;
}
