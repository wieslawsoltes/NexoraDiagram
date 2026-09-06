import { routeConnector } from './router.js';
self.onmessage = ({ data }) => {
  const { revision, pageId, requests, obstacles } = data;
  try { const routes = requests.map(r => routeConnector(r, obstacles)); self.postMessage({ revision, pageId, routes }); }
  catch (error) { self.postMessage({ revision, pageId, error: String(error?.message || error) }); }
};
