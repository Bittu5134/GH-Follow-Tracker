import { THEMES, SIZE_PRESETS, DEFAULT_STATE } from './config.js';

const formatNum = (n) => {
	if (n >= 1e6) {
		const val = n / 1e6;
		return (val >= 100 ? Math.round(val) : val.toFixed(1).replace(/\.0$/, '')) + 'm';
	}
	if (n >= 1e3) {
		const val = n / 1e3;
		return (val >= 100 ? Math.round(val) : val.toFixed(1).replace(/\.0$/, '')) + 'k';
	}
	return n.toString();
};

const generatePoints = (data, timeframe = 'alltime', density = 100, smoothing = 1) => {
	const rawCreatedAt = data.createdAt;
	if (!rawCreatedAt) return [0, 0];

	// --- UTILS ---
	const toUtcMidnight = (d) => {
		const date = new Date(d);
		if (isNaN(date.getTime())) return Date.now();
		return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
	};
	const diffDays = (d1, d2) => Math.floor((d2 - d1) / 86400000);

	const startAccDate = toUtcMidnight(rawCreatedAt);
	const firstObservedDate = toUtcMidnight(data.history?.[0]?.timestamp || new Date());
	const endDate = toUtcMidnight(new Date());

	const totalDays = Math.max(1, diffDays(startAccDate, endDate));
	const daysInA = Math.max(0, diffDays(startAccDate, firstObservedDate));

	let dailyList = [];

	// --- PART A: Predict graph ---
	const targetCountA = data.history?.[0]?.followerCount || 0;
	let reverseA = [];
	let currentCount = targetCountA;

	const coverageFactor = 0.6 + Math.random() * 0.4;
	const targetDuration = Math.floor(daysInA * coverageFactor);

	for (let i = 0; i < daysInA; i++) {
		reverseA.push(currentCount);
		if (currentCount > 0) {
			const daysRemaining = targetDuration - i;
			if (daysRemaining <= 0) {
				currentCount = 0;
			} else {
				const dropRate = currentCount / daysRemaining;
				let drop = 0;
				if (dropRate < 1) {
					if (Math.random() < dropRate) {
						drop = 1;
					}
				} else {
					const variance = dropRate * 0.3;
					drop = Math.round(dropRate + (Math.random() * variance * 2 - variance));
				}
				currentCount = Math.max(0, currentCount - drop);
			}
		}
	}
	dailyList = reverseA.reverse();
	const milestones = (data.history || []).map((h) => ({
		day: diffDays(startAccDate, toUtcMidnight(h.timestamp)),
		count: h.followerCount,
	}));

	for (let d = daysInA; d <= totalDays; d++) {
		if (milestones.length === 0) {
			dailyList.push(targetCountA);
			continue;
		}

		let currentVal;
		const lastMilestone = milestones[milestones.length - 1];

		if (d >= lastMilestone.day) {
			currentVal = lastMilestone.count;
		} else {
			let start = milestones[0];
			let end = milestones[milestones.length - 1];

			for (let j = 0; j < milestones.length - 1; j++) {
				if (d >= milestones[j].day && d <= milestones[j + 1].day) {
					start = milestones[j];
					end = milestones[j + 1];
					break;
				}
			}

			const dRange = end.day - start.day;
			const vRange = end.count - start.count;
			const progress = dRange === 0 ? 1 : (d - start.day) / dRange;
			currentVal = start.count + vRange * progress;
		}

		const prev = dailyList.length > 0 ? dailyList[dailyList.length - 1] : 0;
		dailyList.push(Math.max(prev, currentVal));
	}

	// --- SLICING & SMOOTHING ---
	const limits = { week: 7, fortnight: 14, month: 30, three_months: 90, six_months: 180, year: 365, alltime: Infinity };
	const windowSize = Math.min(limits[timeframe] || dailyList.length, dailyList.length);

	const actualSmoothing = Math.floor(smoothing);
	const sliceStart = Math.max(0, dailyList.length - windowSize - actualSmoothing);
	const visibleRawList = dailyList.slice(sliceStart);

	// Simple Moving Average
	let smoothedList = visibleRawList.map((val, idx) => {
		if (actualSmoothing <= 1) return val;
		let start = Math.max(0, idx - actualSmoothing);
		let end = Math.min(visibleRawList.length, idx + actualSmoothing + 1);
		let subset = visibleRawList.slice(start, end);
		return subset.reduce((a, b) => a + b, 0) / subset.length;
	});

	const finalVisibleList = smoothedList.slice(-windowSize);

	// --- DENSITY SAMPLING ---
	const targetDensity = Math.max(2, Math.min(density, finalVisibleList.length));
	const finalPoints = [];
	for (let i = 0; i < targetDensity; i++) {
		const index = (i / (targetDensity - 1)) * (finalVisibleList.length - 1);
		const low = Math.floor(index);
		const high = Math.ceil(index);
		const weight = index - low;

		const interpolatedVal = finalVisibleList[low] + weight * ((finalVisibleList[high] || finalVisibleList[low]) - finalVisibleList[low]);
		finalPoints.push(Math.round(interpolatedVal));
	}

	return finalPoints;
};

export function generateChartSVG(options = {}) {
	console.log(Object.keys(THEMES));

	const val = {
		...DEFAULT_STATE,
		...THEMES[options.theme],
		...SIZE_PRESETS[options.preset],
		...options,
	};

	let data = generatePoints(val.dataset, val.time, val.density);
	let uniqueData = new Set(data);
	console.log(data);
	console.log(uniqueData);
	console.log((uniqueData.size * 100) / data.length);

	if ((uniqueData.size * 100) / data.length < 60) val.paddingT += (100 - val.paddingT) / 2;

	if (!val.border) val.bWidth = 0;

	const width = val.width;
	const height = val.height;
	const padT = (height * val.paddingT) / 100;
	const padB = (height * val.paddingB) / 100;
	const padL = (width * val.paddingL) / 100;
	const padR = (width * val.paddingR) / 100;

	const drawWidth = width - padL - padR;
	const drawHeight = height - padT - padB;

	const max = Math.max(...data);
	const min = Math.min(...data);
	const range = max === min ? 1 : max - min;

	const coords = data.map((val, i) => [padL + (i / (data.length - 1)) * drawWidth, height - padB - ((val - min) / range) * drawHeight]);

	let path = `M ${coords[0][0]},${coords[0][1]}`;
	const smoothVal = Math.min(val.smooth, 0.5);

	coords.forEach((p, i) => {
		if (i === 0) return;
		if (smoothVal > 0) {
			const prev = coords[i - 1];
			const dx = (p[0] - prev[0]) * smoothVal;
			const cp1x = prev[0] + dx;
			const cp1y = prev[1];
			const cp2x = p[0] - dx;
			const cp2y = p[1];
			path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p[0]},${p[1]}`;
		} else {
			path += ` L ${p[0]},${p[1]}`;
		}
	});

	const areaPath = `${path} L ${coords[coords.length - 1][0]},${height - padB} L ${padL},${height - padB} Z`;
	const titleX = val.textPosX;
	const titleY = val.textPosY;
	const subY = (val.textPosY * height) / 100 + val.textSize * 0.5;

	const angleRad = Math.abs((val.rotate * Math.PI) / 180);
	const rotatedWidth = width * Math.cos(angleRad) + height * Math.sin(angleRad);
	const rotatedHeight = width * Math.sin(angleRad) + height * Math.cos(angleRad);
	const scale = Math.min(width / rotatedWidth, height / rotatedHeight);
	const rot = `translate(${width / 2} ${height / 2}) scale(${scale}) rotate(${val.rotate || 0}) translate(${-width / 2} ${-height / 2})`;

	return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
        <clipPath id="round-corner">
            <rect width="${width}" height="${height}" rx="${val.round}%" transform="${rot}" />
        </clipPath>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#${val.col_area}" stop-opacity="0.4" />
            <stop offset="100%" stop-color="#${val.col_area}" stop-opacity="0" />
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#${val.col_bg}" flood-opacity="1" />
        </filter>
    </defs>
    
    <g clip-path="url(#round-corner)">
        <rect width="100%" height="100%" fill="#${val.col_bg}" transform="${rot}" />
        <path d="${areaPath}" fill="url(#grad)" />
        <path d="${path}" fill="none" stroke="#${val.col_line}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
        <text filter="url(#glow)" x="${titleX}%" y="${titleY}%" text-anchor="middle" dominant-baseline="middle" font-family="${val.font}" text-shadow="10 10 10 white" font-size="${val.textSize}" font-weight="bold" fill="#${val.col_title}">${formatNum(data[data.length - 1])}</text>
        <text filter="url(#glow)" x="${titleX}%" y="${subY}" text-anchor="middle" dominant-baseline="middle" font-family="${val.font}" font-size="${val.textSize * 0.25}" fill="#${val.col_sub}">${val.subtitleText}</text>
    </g>

    ${
			val.bWidth > 0
				? `
    <rect x="${val.bWidth / 2}" y="${val.bWidth / 2}" rx="${val.round}%" width="${width - val.bWidth}" height="${height - val.bWidth}" fill="none" stroke="#${val.col_bg}" stroke-width="${val.bWidth}" transform="${rot}" />
    <rect x="${val.bWidth / 2}" y="${val.bWidth / 2}" rx="${val.round}%" width="${width - val.bWidth}" height="${height - val.bWidth}" fill="none" stroke="#${val.col_border}" stroke-width="${val.bWidth}" transform="${rot}" />
    `
				: ''
		}</svg>`.trim();
}
