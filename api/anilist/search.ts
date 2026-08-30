import { anilistApi } from '../../server/anilistCache.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const q = String(req.query?.q || req.query?.query || '');
    const filters: Record<string, any> = {};
    const keys = ['page','perPage','genre','genres','country','season','year','seasonYear','status','type','format','rating','order_by','sort'];
    for (const key of keys) {
      const value = req.query?.[key];
      if (value !== undefined && value !== '') filters[key] = Array.isArray(value) ? value[0] : value;
    }
    if (filters.genres && !filters.genre) filters.genre = filters.genres;
    const results = await anilistApi.searchAnime(q, filters);
    res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=600');
    return res.status(200).json(results || { results: [], pageInfo: { currentPage: Number(filters.page) || 1, hasNextPage: false } });
  } catch (error: any) {
    return res.status(502).json({ error: error?.message || 'Failed to search anime.' });
  }
}
