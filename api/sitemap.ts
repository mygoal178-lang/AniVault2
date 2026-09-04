import { supabase } from '../server/supabase.js';

const SITE_URL = 'https://www.anivault.online';

function slugify(text: string): string {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default async function handler(req: any, res: any) {
  try {
    const { data: anime, error } = await supabase
      .from('anime')
      .select('external_id, title, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[AniVault Sitemap]', error);
      return res.status(500).send('Failed to generate sitemap');
    }

    const staticUrls = [
      {
        loc: `${SITE_URL}/`,
        changefreq: 'daily',
        priority: '1.0',
      },
      {
        loc: `${SITE_URL}/home`,
        changefreq: 'daily',
        priority: '0.9',
      },
      {
        loc: `${SITE_URL}/genres`,
        changefreq: 'weekly',
        priority: '0.8',
      },
      {
        loc: `${SITE_URL}/updated`,
        changefreq: 'hourly',
        priority: '0.8',
      },
    ];

    const animeUrls = (anime || [])
      .filter((item: any) => item.external_id && item.title)
      .map((item: any) => {
        const slug = slugify(item.title);
        const id = Number(item.external_id);

        return {
          loc: `${SITE_URL}/anime/${slug}-${id}`,
          lastmod: item.updated_at
            ? new Date(item.updated_at).toISOString()
            : undefined,
          changefreq: 'weekly',
          priority: '0.9',
        };
      });

    const urls = [...staticUrls, ...animeUrls];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${escapeXml(url.loc)}</loc>
    ${url.lastmod ? `<lastmod>${url.lastmod}</lastmod>` : ''}
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=3600, stale-while-revalidate=86400'
    );

    return res.status(200).send(xml);
  } catch (error) {
    console.error('[AniVault Sitemap]', error);
    return res.status(500).send('Failed to generate sitemap');
  }
}
