const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // in milliseconds
}

const cache = new Map<string, CacheEntry<any>>();
// Cache is process-local. On Vercel serverless it resets on cold starts;
// that is expected and still reduces AniList calls within a warm instance.

// Throttle queue to prevent hitting AniList rate limits (AniList limit is 90 req/min)
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 400; // 400ms interval (~150 req/min limit headroom)

async function throttle() {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_REQUEST_INTERVAL) {
    const delay = MIN_REQUEST_INTERVAL - timeSinceLast;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  lastRequestTime = Date.now();
}

async function queryAniList<T>(query: string, variables: Record<string, any> = {}, ttlSeconds = 600): Promise<T> {
  const cacheKey = JSON.stringify({ query, variables });
  const now = Date.now();

  // Check cache
  if (cache.has(cacheKey)) {
    const entry = cache.get(cacheKey)!;
    if (now - entry.timestamp < entry.ttl) {
      return entry.data as T;
    }
  }

  // Throttle request
  await throttle();

  let retries = 3;
  let backoff = 1000;

  while (retries > 0) {
    try {
      const response = await fetch(ANILIST_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      });

      if (response.status === 429) {
        retries--;
        await new Promise((res) => setTimeout(res, backoff));
        backoff *= 2;
        continue;
      }

      if (!response.ok) {
        throw new Error(`AniList API Error ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();
      if (json.errors && json.errors.length > 0) {
        throw new Error(`AniList GraphQL Error: ${json.errors[0].message}`);
      }

      const resultData = json.data;

      // Store in cache
      cache.set(cacheKey, {
        data: resultData,
        timestamp: now,
        ttl: ttlSeconds * 1000,
      });

      return resultData as T;
    } catch (err: any) {
      retries--;
      if (retries === 0) {
        if (cache.has(cacheKey)) {
          return cache.get(cacheKey)!.data as T;
        }
        throw err;
      }
      await new Promise((res) => setTimeout(res, backoff));
      backoff *= 2;
    }
  }

  throw new Error('Failed to query AniList API');
}

// Helper to strip HTML tags from AniList descriptions
function cleanDescription(desc?: string | null): string {
  if (!desc) return '';
  return desc.replace(/<[^>]*>?/gm, '').trim();
}

// Helper to calculate current season and year
function getCurrentSeasonAndYear() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  let season = 'WINTER';
  if (month >= 2 && month <= 4) season = 'SPRING';
  else if (month >= 5 && month <= 7) season = 'SUMMER';
  else if (month >= 8 && month <= 10) season = 'FALL';
  return { season, year };
}

// Normalize AniList Media object into standard format expected by site
export function normalizeAniListMedia(media: any) {
  if (!media) return null;

  const titleEnglish = media.title?.english || null;
  const titleRomaji = media.title?.romaji || null;
  const titleNative = media.title?.native || null;
  const primaryTitle = titleEnglish || titleRomaji || media.title?.userPreferred || 'Anime Title';

  const coverUrl = media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium || '';
  const bannerUrl = media.bannerImage || coverUrl;

  const genres = (media.genres || []).map((name: string, index: number) => ({
    mal_id: index + 1,
    name,
    type: 'genre',
    url: '',
  }));

  const studios = (media.studios?.nodes || []).map((s: any) => ({
    mal_id: s.id,
    name: s.name,
    type: 'studio',
    url: '',
  }));

  let trailer = null;
  if (media.trailer && media.trailer.site === 'youtube') {
    trailer = {
      youtube_id: media.trailer.id,
      url: `https://www.youtube.com/watch?v=${media.trailer.id}`,
      embed_url: `https://www.youtube.com/embed/${media.trailer.id}`,
      images: {
        image_url: media.trailer.thumbnail || null,
        small_image_url: null,
        medium_image_url: null,
        large_image_url: null,
        maximum_image_url: null,
      },
    };
  }

  const score = media.averageScore ? Number((media.averageScore / 10).toFixed(1)) : null;

  // The rest of AniVault uses MAL IDs for routes, Supabase external_id,
  // watchlist, watch history, and episode relationships. AniList also has
  // its own numeric ID, so never expose the AniList ID as `mal_id`.
  // Keep both IDs explicitly to avoid the old Anime Not Found / wrong-anime
  // bug caused by mixing the two identifier systems.
  const malId = Number(media.idMal || 0) || null;
  const aniListId = Number(media.id || 0) || null;

  return {
    // Canonical application ID is always the MAL ID. Keep AniList's native ID separately.
    mal_id: malId,
    id: aniListId,
    idMal: malId,
    anilist_id: aniListId,
    url: `https://anilist.co/anime/${aniListId}`,
    title: primaryTitle,
    title_english: titleEnglish,
    title_japanese: titleNative,
    synopsis: cleanDescription(media.description),
    type: media.format || 'TV',
    status: media.status === 'FINISHED' ? 'Finished Airing' : media.status === 'RELEASING' ? 'Currently Airing' : media.status === 'NOT_YET_RELEASED' ? 'Not Yet Aired' : media.status || 'Finished Airing',
    episodes: media.episodes || null,
    duration: media.duration ? `${media.duration} min` : null,
    score: score,
    popularity: media.popularity || null,
    rank: media.trending || null,
    year: media.seasonYear || (media.startDate?.year ? media.startDate.year : new Date().getFullYear()),
    season: media.season ? media.season.toLowerCase() : null,
    countryOfOrigin: media.countryOfOrigin || 'JP',
    updatedAt: media.updatedAt || null,
    nextAiringEpisode: media.nextAiringEpisode
      ? {
          episode: media.nextAiringEpisode.episode,
          timeUntilAiring: media.nextAiringEpisode.timeUntilAiring,
          airingAt: media.nextAiringEpisode.airingAt,
        }
      : null,
    images: {
      jpg: {
        image_url: coverUrl,
        large_image_url: coverUrl,
      },
    },
    banner_url: bannerUrl,
    genres,
    studios,
    trailer,
  };
}

const MEDIA_FIELDS = `
  id
  idMal
  title {
    romaji
    english
    native
    userPreferred
  }
  coverImage {
    extraLarge
    large
    medium
    color
  }
  bannerImage
  description
  format
  status
  episodes
  duration
  season
  seasonYear
  averageScore
  meanScore
  popularity
  favourites
  trending
  genres
  countryOfOrigin
  updatedAt
  nextAiringEpisode {
    episode
    timeUntilAiring
    airingAt
  }
  startDate {
    year
    month
    day
  }
  studios (isMain: true) {
    nodes {
      id
      name
    }
  }
  trailer {
    id
    site
    thumbnail
  }
`;

export const anilistApi = {
  async getAnimeByMalId(malId: number) {
    if (!malId || isNaN(Number(malId))) return null;
    const idMal = Number(malId);
    const malQuery = `
      query ($idMal: Int) {
        Media (idMal: $idMal, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    `;
    try {
      const res = await queryAniList<any>(malQuery, { idMal }, 3600);
      return res?.Media ? normalizeAniListMedia(res.Media) : null;
    } catch {
      return null;
    }
  },

  async getAnimeById(id: number) {
    if (!id || isNaN(Number(id))) return null;
    const numId = Number(id);

    // Try lookup by idMal first (if passed ID is a MAL ID, e.g. 38000, 16498)
    const malQuery = `
      query ($idMal: Int) {
        Media (idMal: $idMal, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    `;

    try {
      const res = await queryAniList<any>(malQuery, { idMal: numId }, 3600);
      if (res?.Media) {
        return normalizeAniListMedia(res.Media);
      }
    } catch {
      // Fall through to query by AniList native id
    }

    // Try lookup by native AniList ID
    const anilistQuery = `
      query ($id: Int) {
        Media (id: $id, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }
    `;

    try {
      const res = await queryAniList<any>(anilistQuery, { id: numId }, 3600);
      if (res?.Media) {
        return normalizeAniListMedia(res.Media);
      }
    } catch {
      // Not found
    }

    return null;
  },

  async getAnimeCharacters(id: number) {
    if (!id || isNaN(Number(id))) return [];
    const numId = Number(id);

    const malQuery = `
      query ($idMal: Int) {
        Media (idMal: $idMal, type: ANIME) {
          characters (sort: [ROLE, RELEVANCE], perPage: 12) {
            edges {
              role
              node {
                id
                name {
                  full
                  native
                }
                image {
                  large
                  medium
                }
              }
            }
          }
        }
      }
    `;

    try {
      const res = await queryAniList<any>(malQuery, { idMal: numId }, 3600);
      const edges = res?.Media?.characters?.edges || [];
      if (edges.length > 0) {
        return edges.map((e: any) => ({
          character: {
            mal_id: e.node.id,
            name: e.node.name?.full || e.node.name?.native || 'Character',
            url: `https://anilist.co/character/${e.node.id}`,
            images: {
              jpg: {
                image_url: e.node.image?.large || e.node.image?.medium || '',
              },
            },
          },
          role: e.role || 'MAIN',
        }));
      }
    } catch {
      // Fall through to native ID
    }

    const anilistQuery = `
      query ($id: Int) {
        Media (id: $id, type: ANIME) {
          characters (sort: [ROLE, RELEVANCE], perPage: 12) {
            edges {
              role
              node {
                id
                name {
                  full
                  native
                }
                image {
                  large
                  medium
                }
              }
            }
          }
        }
      }
    `;

    try {
      const res = await queryAniList<any>(anilistQuery, { id: numId }, 3600);
      const edges = res?.Media?.characters?.edges || [];
      return edges.map((e: any) => ({
        character: {
          mal_id: e.node.id,
          name: e.node.name?.full || e.node.name?.native || 'Character',
          url: `https://anilist.co/character/${e.node.id}`,
          images: {
            jpg: {
              image_url: e.node.image?.large || e.node.image?.medium || '',
            },
          },
        },
        role: e.role || 'MAIN',
      }));
    } catch {
      return [];
    }
  },

  async searchAnime(queryStr: string, filters: Record<string, any> = {}) {
    const pageNum = Math.max(1, Number(filters.page) || 1);
    const perPageNum = Math.min(50, Math.max(1, Number(filters.perPage) || 24));
    const variables: Record<string, any> = {
      page: pageNum,
      perPage: perPageNum,
    };

    if (queryStr && queryStr.trim()) {
      variables.search = queryStr.trim();
    }

    if (filters.genre && String(filters.genre).toLowerCase() !== 'all') {
      const gRaw = String(filters.genre).trim();
      const knownGenres = [
        'Action',
        'Adventure',
        'Comedy',
        'Drama',
        'Fantasy',
        'Horror',
        'Mahou Shoujo',
        'Mecha',
        'Music',
        'Mystery',
        'Psychological',
        'Romance',
        'Sci-Fi',
        'Slice of Life',
        'Sports',
        'Supernatural',
        'Thriller',
      ];

      let genreName: string | null = null;
      const numId = parseInt(gRaw, 10);
      if (!isNaN(numId) && String(numId) === gRaw && numId >= 1 && numId <= knownGenres.length) {
        genreName = knownGenres[numId - 1];
      } else {
        const lowerRaw = gRaw.toLowerCase().replace(/[^a-z]/g, '');
        const matched = knownGenres.find(
          (kg) => kg.toLowerCase().replace(/[^a-z]/g, '') === lowerRaw
        );
        if (matched) {
          genreName = matched;
        } else {
          genreName = gRaw.charAt(0).toUpperCase() + gRaw.slice(1);
        }
      }

      if (genreName) {
        variables.genre = genreName;
      }
    }

    // Country of Origin filter (JP, CN, KR, TW)
    if (filters.country && String(filters.country).toLowerCase() !== 'all') {
      const countryRaw = String(filters.country).toUpperCase().trim();
      if (['JP', 'CN', 'KR', 'TW'].includes(countryRaw)) {
        variables.countryOfOrigin = countryRaw;
      }
    }

    // Season filter (WINTER, SPRING, SUMMER, FALL)
    if (filters.season && String(filters.season).toLowerCase() !== 'all') {
      const seasonUpper = String(filters.season).toUpperCase().trim();
      if (['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(seasonUpper)) {
        variables.season = seasonUpper;
      }
    }

    // Year / SeasonYear filter
    const yearVal = filters.seasonYear || filters.year;
    if (yearVal && String(yearVal).toLowerCase() !== 'all') {
      const parsedYear = parseInt(String(yearVal), 10);
      if (!isNaN(parsedYear) && parsedYear > 1950 && parsedYear < 2100) {
        variables.seasonYear = parsedYear;
      }
    }

    // Status filter
    if (filters.status && String(filters.status).toLowerCase() !== 'all') {
      const statusLower = String(filters.status).toLowerCase().trim();
      if (statusLower === 'airing' || statusLower === 'releasing') variables.status = 'RELEASING';
      else if (statusLower === 'complete' || statusLower === 'finished') variables.status = 'FINISHED';
      else if (statusLower === 'upcoming' || statusLower === 'not_yet_released') variables.status = 'NOT_YET_RELEASED';
      else if (statusLower === 'cancelled') variables.status = 'CANCELLED';
      else if (statusLower === 'hiatus') variables.status = 'HIATUS';
    }

    // Type / Format filter
    const typeVal = filters.format || filters.type;
    if (typeVal && String(typeVal).toLowerCase() !== 'all') {
      const typeUpper = String(typeVal).toUpperCase().trim();
      if (['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'].includes(typeUpper)) {
        variables.format = typeUpper;
      } else if (typeUpper === 'TV SERIES') {
        variables.format = 'TV';
      }
    }

    // Rating / Min Score filter (e.g. 9+ stars -> 85+, 8+ stars -> 75+, etc.)
    if (filters.rating && String(filters.rating).toLowerCase() !== 'all') {
      const rRaw = String(filters.rating).replace(/[^0-9.]/g, '');
      const rNum = parseFloat(rRaw);
      if (!isNaN(rNum) && rNum > 0) {
        // If passed as 9 or 8 or 7 (scale of 10) -> score scale is 0-100 in AniList
        const threshold = rNum <= 10 ? Math.round(rNum * 10) : Math.round(rNum);
        variables.averageScore_greater = threshold - 2; // small tolerance so 8.0 matches 78+
      }
    }

    // Sort mappings
    const sortVal = String(filters.sort || filters.order_by || '').toLowerCase().trim();
    if (sortVal === 'updated_at' || sortVal === 'recently_updated' || sortVal === 'updated' || sortVal === 'recent') {
      variables.sort = ['UPDATED_AT_DESC'];
    } else if (sortVal === 'newest' || sortVal === 'start_date' || sortVal === 'recently_added' || sortVal === 'latest') {
      variables.sort = ['START_DATE_DESC'];
    } else if (sortVal === 'score' || sortVal === 'highest_rated' || sortVal === 'top_rated' || sortVal === 'rating') {
      variables.sort = ['SCORE_DESC'];
    } else if (sortVal === 'popularity' || sortVal === 'most_popular' || sortVal === 'popular') {
      variables.sort = ['POPULARITY_DESC'];
    } else if (sortVal === 'trending') {
      variables.sort = ['TRENDING_DESC'];
    } else if (sortVal === 'favourites' || sortVal === 'favorite') {
      variables.sort = ['FAVOURITES_DESC'];
    } else if (sortVal === 'title') {
      variables.sort = ['TITLE_ROMAJI'];
    } else {
      // Default to UPDATED_AT_DESC for catalog updates
      variables.sort = ['UPDATED_AT_DESC'];
    }

    const query = `
      query (
        $search: String,
        $page: Int,
        $perPage: Int,
        $genre: String,
        $countryOfOrigin: CountryCode,
        $season: MediaSeason,
        $seasonYear: Int,
        $status: MediaStatus,
        $format: MediaFormat,
        $averageScore_greater: Int,
        $sort: [MediaSort]
      ) {
        Page (page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
            perPage
          }
          media (
            search: $search,
            genre: $genre,
            countryOfOrigin: $countryOfOrigin,
            season: $season,
            seasonYear: $seasonYear,
            status: $status,
            format: $format,
            averageScore_greater: $averageScore_greater,
            sort: $sort,
            type: ANIME,
            isAdult: false
          ) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;

    const res = await queryAniList<any>(query, variables, 300);
    const mediaList = res?.Page?.media || [];
    const normalized = mediaList.map(normalizeAniListMedia).filter(Boolean);
    const rawPageInfo = res?.Page?.pageInfo;
    const pageInfo = {
      total: rawPageInfo?.total || undefined,
      currentPage: rawPageInfo?.currentPage || pageNum,
      lastPage: rawPageInfo?.lastPage || (normalized.length === perPageNum ? pageNum + 1 : pageNum),
      hasNextPage: rawPageInfo?.hasNextPage ?? (normalized.length === perPageNum),
      perPage: rawPageInfo?.perPage || perPageNum,
    };
    return {
      results: normalized,
      pageInfo,
    };
  },

  async getTopAnime(filter = 'bypopularity', page = 1) {
    let sort = ['POPULARITY_DESC'];
    if (filter === 'favorite' || filter === 'score') {
      sort = ['SCORE_DESC'];
    } else if (filter === 'airing') {
      sort = ['TRENDING_DESC'];
    }

    const query = `
      query ($page: Int, $perPage: Int, $sort: [MediaSort]) {
        Page (page: $page, perPage: $perPage) {
          media (sort: $sort, type: ANIME, isAdult: false) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;

    const res = await queryAniList<any>(query, { page, perPage: 20, sort }, 1800);
    const mediaList = res?.Page?.media || [];
    return mediaList.map(normalizeAniListMedia).filter(Boolean);
  },

  async getCurrentSeasonAnime(page = 1) {
    const { season, year } = getCurrentSeasonAndYear();

    const query = `
      query ($season: MediaSeason, $seasonYear: Int, $page: Int, $perPage: Int) {
        Page (page: $page, perPage: $perPage) {
          media (season: $season, seasonYear: $seasonYear, sort: [POPULARITY_DESC], type: ANIME, isAdult: false) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;

    const res = await queryAniList<any>(query, { season, seasonYear: year, page, perPage: 20 }, 1800);
    const mediaList = res?.Page?.media || [];
    return mediaList.map(normalizeAniListMedia).filter(Boolean);
  },

  async getGenres() {
    const query = `
      query {
        GenreCollection
      }
    `;
    const res = await queryAniList<any>(query, {}, 86400);
    const genres: string[] = res?.GenreCollection || [
      'Action',
      'Adventure',
      'Comedy',
      'Drama',
      'Fantasy',
      'Horror',
      'Mahou Shoujo',
      'Mecha',
      'Music',
      'Mystery',
      'Psychological',
      'Romance',
      'Sci-Fi',
      'Slice of Life',
      'Sports',
      'Supernatural',
      'Thriller',
    ];

    return genres.map((name, index) => ({
      mal_id: index + 1,
      name,
      count: 500,
    }));
  },
};
