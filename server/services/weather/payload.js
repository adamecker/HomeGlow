const CONDITIONS = [
    'clear-night',
    'cloudy',
    'exceptional',
    'fog',
    'hail',
    'lightning',
    'lightning-rainy',
    'partlycloudy',
    'pouring',
    'rainy',
    'snowy',
    'snowy-rainy',
    'sunny',
    'windy',
    'windy-variant',
];

const CONDITION_SET = new Set(CONDITIONS);
const UNKNOWN_CONDITION = 'exceptional';

function normalizeCondition(candidate) {
    const token = String(candidate || '').trim().toLowerCase();
    return CONDITION_SET.has(token) ? token : UNKNOWN_CONDITION;
}

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const optionalNumber = (value) => (isFiniteNumber(value) ? value : null);

function validatePayload(payload) {
    const problems = [];
    if (!payload || typeof payload !== 'object') {
        return ['payload is not an object'];
    }

    const { coordinates, current, forecast, hourly, airQuality } = payload;

    if (!coordinates || !isFiniteNumber(coordinates.lat) || !isFiniteNumber(coordinates.lon)) {
        problems.push('coordinates must have finite lat and lon');
    }

    if (!current || typeof current !== 'object') {
        problems.push('current is required');
    } else {
        if (!isFiniteNumber(current.temp)) problems.push('current.temp must be a finite number');
        if (!CONDITION_SET.has(current.condition)) {
            problems.push(`current.condition "${current.condition}" is not in the vocabulary`);
        }
    }

    if (!Array.isArray(forecast)) {
        problems.push('forecast must be an array');
    } else {
        forecast.forEach((day, index) => {
            if (typeof day?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
                problems.push(`forecast[${index}].date must be a YYYY-MM-DD string`);
            }
            if (!CONDITION_SET.has(day?.condition)) {
                problems.push(`forecast[${index}].condition "${day?.condition}" is not in the vocabulary`);
            }
        });
    }

    if (!Array.isArray(hourly)) {
        problems.push('hourly must be an array');
    } else {
        hourly.forEach((point, index) => {
            if (!isFiniteNumber(point?.timestamp)) {
                problems.push(`hourly[${index}].timestamp must be a unix seconds number`);
            }
        });
    }

    if (airQuality !== null && airQuality !== undefined) {
        if (!isFiniteNumber(airQuality.aqi)) {
            problems.push('airQuality.aqi must be a finite number when airQuality is present');
        }
    }

    return problems;
}

function buildPayload({
    provider,
    coordinates,
    resolvedName = '',
    units,
    current,
    forecast = [],
    hourly = [],
    airQuality = null,
    sun = null,
}) {
    return {
        provider,
        units,
        coordinates: { lat: coordinates.lat, lon: coordinates.lon },
        resolvedName: resolvedName || '',
        current: {
            temp: current.temp,
            feelsLike: optionalNumber(current.feelsLike),
            humidity: optionalNumber(current.humidity),
            windSpeed: optionalNumber(current.windSpeed),
            condition: normalizeCondition(current.condition),
            description: current.description || null,
        },
        forecast: forecast.map((day) => ({
            date: day.date,
            high: optionalNumber(day.high),
            low: optionalNumber(day.low),
            condition: normalizeCondition(day.condition),
            description: day.description || null,
            precipitation: optionalNumber(day.precipitation),
            pop: optionalNumber(day.pop),
        })),
        hourly: hourly.map((point) => ({
            timestamp: point.timestamp,
            temp: optionalNumber(point.temp),
            precipitation: optionalNumber(point.precipitation),
            pop: optionalNumber(point.pop),
            condition: point.condition ? normalizeCondition(point.condition) : undefined,
            date: point.date || null,
        })),
        airQuality: airQuality ? {
            aqi: airQuality.aqi,
            pm2_5: optionalNumber(airQuality.pm2_5),
            pm10: optionalNumber(airQuality.pm10),
            o3: optionalNumber(airQuality.o3),
        } : null,
        sun: sun ? { sunrise: sun.sunrise, sunset: sun.sunset } : null,
    };
}

module.exports = {
    CONDITIONS,
    UNKNOWN_CONDITION,
    normalizeCondition,
    validatePayload,
    buildPayload,
};
