import { anilistApi } from '../../server/anilistCache.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const genres = await anilistApi.getGenres();
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(genres || []);
  } catch (error: any) {
    return res.status(502).json({ error: error?.message || 'Failed to fetch genres.' });
  }
}
