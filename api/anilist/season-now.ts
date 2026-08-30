import { anilistApi } from '../../server/anilistCache.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const page = Math.max(1, Number(req.query?.page || 1));
    const results = await anilistApi.getCurrentSeasonAnime(page);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(results || { results: [] });
  } catch (error: any) {
    return res.status(502).json({ error: error?.message || 'Failed to fetch seasonal anime.' });
  }
}
