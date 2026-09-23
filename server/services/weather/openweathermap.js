const { buildPayload } = require('./payload');

const GEO_BASE = 'https://api.openweathermap.org/geo/1.0';
const DATA_BASE = 'https://api.openweathermap.org/data/2.5';

const REQUEST_TIMEOUT_MS = 15000;

function conditionFromOwm(id, iconCode) {
    const code = Number(id);
    const isNight = typeof iconCode === 'string' && iconCode.endsWith('n');

    if (code >= 200 && code < 300) {
        return code === 210 || code === 211 || code === 212 || code === 221
            ? 'lightning'
            : 'lightning-rainy';
    }
    if (code >= 300 && code < 400) return 'rainy';
    if (code >= 500 && code < 600) {
        if (code === 502 || code === 503 || code === 504) return 'pouring';
        if (code === 511) return 'snowy-rainy';
        return 'rainy';
    }
    if (code >= 600 && code < 700) {
        if (code >= 611 && code <= 616) return 'snowy-rainy';
        return 'snowy';
    }
    if (code >= 700 && code < 800) {
        if (code === 771 || code === 781) return 'windy';
        return 'fog';
    }
    if (code === 800) return isNight ? 'clear-night' : 'sunny';
    if (code === 801 || code === 802) return 'partlycloudy';
    if (code === 803 || code === 804) return 'cloudy';

    return 'exceptional';
}

async function owmFetch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res;
    try {
        res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (err) {
        if (err.name === 'AbortError') {
            const timeout = new Error('OpenWeatherMap did not respond in time.');
            timeout.status = 504;
            throw timeout;
        }
        const unreachable = new Error('Could not reach OpenWeatherMap.');
        unreachable.status = 503;
        unreachable.cause = err;
        throw unreachable;
    } finally {
        clearTimeout(timer);
    }

    const text = await res.text();
    let parsed = null;
    if (text) {
        try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
    }

    if (!res.ok) {
        const err = new Error(
            res.status === 401
                ? 'OpenWeatherMap rejected the API key.'
                : (parsed && parsed.message) || `OpenWeatherMap error ${res.status}`
        );
        err.status = res.status;
        throw err;
    }

    return parsed;
}

function geocodeCandidates(locationQuery) {
    const base = String(locationQuery || '').trim();
    if (!base) return [];

    const candidates = [base];
    const alreadyUsQualified = /,\s*us(a)?\s*$/i.test(base);
    const hasExplicitCountrySegment = base.split(',').length >= 3;

    if (!alreadyUsQualified && !hasExplicitCountrySegment) {
        candidates.push(`${base},US`);
    }
    return candidates;
}

const looksLikePostalCode = (candidate) => {
    const normalized = String(candidate || '').trim();
    return !!normalized && !/[a-z]/i.test(normalized);
};

function notFound() {
    const err = new Error('Location not found');
    err.status = 404;
    return err;
}

async function resolveCoordinates(locationQuery, apiKey) {
    for (const candidate of geocodeCandidates(locationQuery)) {
        const url = `${GEO_BASE}/direct?q=${encodeURIComponent(candidate)}&limit=1&appid=${apiKey}`;
        try {
            const results = await owmFetch(url);
            if (Array.isArray(results) && results.length > 0) {
                const best = results[0];
                return { lat: best.lat, lon: best.lon, name: best.name || '' };
            }
        } catch (err) {
            if (err.status !== 404) throw err;
        }
    }

    if (looksLikePostalCode(locationQuery)) {
        const zip = locationQuery.includes(',') ? locationQuery : `${locationQuery},US`;
        const url = `${GEO_BASE}/zip?zip=${encodeURIComponent(zip)}&appid=${apiKey}`;
        try {
            const result = await owmFetch(url);
            if (result && typeof result.lat === 'number' && typeof result.lon === 'number') {
                return { lat: result.lat, lon: result.lon, name: result.name || '' };
            }
        } catch (err) {
            if (err.status !== 404) throw err;
        }
    }

    throw notFound();
}

function summarizeForecast(list, timezoneOffsetSeconds, maxHourly = 8) {
    const byDay = new Map();
    const hourly = [];

    for (const item of list) {
        const shifted = new Date((item.dt + (timezoneOffsetSeconds || 0)) * 1000);
        const dayKey = shifted.toISOString().slice(0, 10);

        const existing = byDay.get(dayKey);
        const precipitation = item.rain ? item.rain['3h'] || 0 : 0;
        const pop = typeof item.pop === 'number' ? Math.round(item.pop * 100) : 0;

        if (!existing) {
            byDay.set(dayKey, {
                date: dayKey,
                high: item.main.temp_max,
                low: item.main.temp_min,
                condition: conditionFromOwm(item.weather?.[0]?.id, item.weather?.[0]?.icon),
                description: item.weather?.[0]?.description || null,
                precipitation,
                pop,
            });
        } else {
            existing.high = Math.max(existing.high, item.main.temp_max);
            existing.low = Math.min(existing.low, item.main.temp_min);
            existing.precipitation += precipitation;
            existing.pop = Math.max(existing.pop, pop);
        }

        if (hourly.length < maxHourly) {
            hourly.push({
                timestamp: item.dt,
                temp: item.main.temp,
                precipitation,
                pop,
                date: dayKey,
                condition: conditionFromOwm(item.weather?.[0]?.id, item.weather?.[0]?.icon),
            });
        }
    }

    return { forecast: Array.from(byDay.values()), hourly };
}

async function fetchWeather({ apiKey, locationQuery, coordinates, units, lang }) {
    if (!apiKey) {
        const err = new Error('OpenWeatherMap API key is not configured.');
        err.status = 401;
        throw err;
    }

    const resolved = coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lon)
        ? { ...coordinates, name: '' }
        : await resolveCoordinates(locationQuery, apiKey);

    const { lat, lon } = resolved;
    const common = `lat=${lat}&lon=${lon}&appid=${apiKey}&units=${units}&lang=${lang}`;

    const current = await owmFetch(`${DATA_BASE}/weather?${common}`);

    const [airQualityResult, forecastResult] = await Promise.allSettled([
        owmFetch(`${DATA_BASE}/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`),
        owmFetch(`${DATA_BASE}/forecast?${common}`),
    ]);

    let airQuality = null;
    if (airQualityResult.status === 'fulfilled') {
        const entry = airQualityResult.value?.list?.[0];
        if (entry) {
            airQuality = {
                aqi: entry.main?.aqi,
                pm2_5: entry.components?.pm2_5,
                pm10: entry.components?.pm10,
                o3: entry.components?.o3,
            };
        }
    }

    let forecast = [];
    let hourly = [];
    if (forecastResult.status === 'fulfilled' && Array.isArray(forecastResult.value?.list)) {
        // Pass Infinity so production gets all available forecast points across all days
        const summarized = summarizeForecast(
            forecastResult.value.list,
            forecastResult.value.city?.timezone,
            Infinity
        );
        forecast = summarized.forecast;
        hourly = summarized.hourly;
    }

    return buildPayload({
        provider: 'openweathermap',
        units,
        coordinates: { lat, lon },
        resolvedName: resolved.name || current.name || '',
        current: {
            temp: current.main?.temp,
            feelsLike: current.main?.feels_like,
            humidity: current.main?.humidity,
            windSpeed: current.wind?.speed,
            condition: conditionFromOwm(current.weather?.[0]?.id, current.weather?.[0]?.icon),
            description: current.weather?.[0]?.description || null,
        },
        forecast,
        hourly,
        airQuality,
        sun: Number.isFinite(current.sys?.sunrise) && Number.isFinite(current.sys?.sunset)
            ? { sunrise: current.sys.sunrise, sunset: current.sys.sunset }
            : null,
    });
}

module.exports = {
    fetchWeather,
    conditionFromOwm,
    geocodeCandidates,
    resolveCoordinates,
    summarizeForecast,
};
