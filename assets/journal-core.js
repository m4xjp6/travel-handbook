/* =====================================================================
   °•* Flâneur *•° 電子旅行手帳核心引擎（assets/journal-core.js）
   功能：資料縫合、互動地圖與滾動連動、行程＆遊記渲染、燈箱、情報站、靜態票券
   ===================================================================== */

/* 【⚙️ 功能設定】Google 試算表雲端同步網址（費用明細、行前清單、隨手記事、景點印章） */
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbyRbstjJeBCcJaO4hfQxovl46GEmA_l0YrY9UkhglvVA1zRG7RVazHrbHcIau8gl2c4/exec';

/* 【⚙️ 功能設定】Cloudflare R2 媒體儲存公開網址（結尾不加斜線，未來換專屬網域只須改這行） */
const R2_MEDIA_BASE = 'https://pub-180de6e9b96341e68b7fc31ef30c4a2f.r2.dev';

/* === 1. 全域狀態與共用工具 === */
const $ = id => document.getElementById(id);
const urlParams = new URLSearchParams(location.search);
const tripId = urlParams.get('trip') || 'tohoku_2026';
const isPreviewMode = ['1', 'true'].includes(urlParams.get('preview'));

let rawJournalData = {}, rawItineraryData = {};
let isWholeJournalDraft = false;
let currentTripAvatar = '🦊', currentTripStartDate = null, currentTripEndDate = null, currentTripTimezone = 'Asia/Tokyo';
let currentCurrencyCode = 'JPY', currentCurrencySymbol = '¥';

// 預設外幣對台幣參考匯率（供行程預估項目換算與離線備援）
const FALLBACK_TWD_RATES = { TWD: 1, JPY: 0.215, MYR: 7.35, SGD: 24.3, USD: 32.5, EUR: 35.0, KRW: 0.0235, HKD: 4.18 };
let baselineToTwdRate = 1;
let currentDayKey = 'ALL';

function toTwd(amount, currencyCode) {
    const val = Number(amount) || 0;
    if (!val) return 0;
    const code = String(currencyCode || currentCurrencyCode || 'TWD').toUpperCase();
    if (code === 'TWD') return Math.round(val);
    const rate = (code === currentCurrencyCode) ? baselineToTwdRate : (FALLBACK_TWD_RATES[code] || 1);
    return Math.round(val * rate);
}

// 地圖、監聽器與章節狀態
let map, baseRouteLayer, activeRouteLayer, markersLayer, exploreStampsLayer;
let foxMarker = null, foxAnimFrame = null;
let observer = null, itinObserver = null, videoObserver = null;
let normalizedDays = [], currentChaptersList = [], currentActiveIndex = 0;
let prevDayOriginChapter = null;

// 燈箱與快取
let lightboxItems = [], lightboxIndex = 0, touchStartX = 0, touchStartY = 0, justSwiped = false;
const segmentCoordsCache = {};
const chapterMarkers = new Map();       // section DOM -> marker
const chapterIndexMarkers = new Map();  // chIndex -> marker
let isClickScrolling = false, scrollUnlockTimer = null;

// 情報站狀態
let liveWeatherByDay = {}, allInfoClippings = [], currentClipCategory = 'ALL';

// 供 journal-cloud.js 與旅遊小冊共用的資料快取
let cachedMergedHotels = [];
let cachedTransportTickets = [];
let cachedTransits = [];
let baselineExpensesTWD = [];
let totalTripSpotCount = 0;

// 雲端同步共用狀態（由 journal-cloud.js 讀寫）
let cloudExpenses = [];
let cloudChecklist = [];
let cloudNotes = [];
let cloudStamps = [];
let includeBaselineEstimates = true;
let currentExpenseFilter = 'ALL';
let editingExpenseId = null;
let cloudSyncState = 'loading'; // loading | ready | error
let cloudEditPassword = '';
try { cloudEditPassword = localStorage.getItem('flaneur_gas_pwd') || ''; } catch {}

const CURVE_MODES = { flight: 0.22, hsr: 0.12, boat: 0.12, train: 0.08, metro: 0.05, ropeway: 0.04 };
const isItemDraft = obj => Boolean(obj && (obj.isDraft === true || obj.hidden === true || obj.status === 'draft'));
const escHtml = s => String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const normalizeSpotKey = (day, spotName) => `${String(day || '').trim()}::${String(spotName || '').trim().toLowerCase()}`;

/* === 2. 啟動流程：同步讀取 data/*.json 與 itinerary/*.json 並縫合 === */
function bootJournalApp() {
    initCoreEventListeners();

    Promise.all([
        fetch(`data/${tripId}.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`itinerary/${tripId}.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
    ]).then(([journalJson, itinJson]) => {
        if (!journalJson && !itinJson) throw new Error(`找不到 data/${tripId}.json 或 itinerary/${tripId}.json`);

        rawJournalData = journalJson || {};
        rawItineraryData = itinJson || {};
        isWholeJournalDraft = !isPreviewMode && (!journalJson || isItemDraft(rawJournalData));

        const isMY = tripId.includes('malaysia');
        const mainTitle = rawItineraryData.tripTitle || rawJournalData.tripTitle || '電子旅行手帳';
        document.title = mainTitle;
        $('trip-title').textContent = mainTitle;

        currentTripAvatar = rawItineraryData.avatar || rawJournalData.avatar || (isMY ? '🦁' : '🦊');
        currentTripStartDate = rawItineraryData.startDate || rawJournalData.startDate || null;
        currentTripEndDate = rawItineraryData.endDate || rawJournalData.endDate || null;
        currentTripTimezone = rawItineraryData.timezone || (isMY ? 'Asia/Kuala_Lumpur' : 'Asia/Tokyo');
        currentCurrencyCode = rawItineraryData.currency || rawJournalData.currency || (isMY ? 'TWD' : 'JPY');
        currentCurrencySymbol = rawItineraryData.currencySymbol || ({ TWD: 'NT$', MYR: 'RM', SGD: 'S$', JPY: '¥' }[currentCurrencyCode] || '¥');
        baselineToTwdRate = FALLBACK_TWD_RATES[currentCurrencyCode] || 1;

        const itinSpotById = new Map(), itinDayByName = new Map();
        (rawItineraryData.days || []).forEach(d => {
            if (d.day) itinDayByName.set(d.day, d);
            (d.spots || []).forEach(sp => sp.id && itinSpotById.set(sp.id, { ...sp, dayRegion: d.region || '' }));
        });

        // 無論遊記是否為草稿，皆先建立章節索引作為分潤連結備援（相容舊旅程）
        const journalChapById = new Map();
        (rawJournalData.days || []).forEach(d => (d.chapters || []).forEach(ch => ch.id && journalChapById.set(ch.id, ch)));
        (rawJournalData.chapters || []).forEach(ch => ch.id && journalChapById.set(ch.id, ch));

        const fallbackCoord = isMY ? { lat: 3.1390, lng: 101.6869 } : { lat: 35.6895, lng: 139.6917 };
        let baseDays = [];
        if (!isWholeJournalDraft && Array.isArray(rawJournalData.days) && rawJournalData.days.length) {
            baseDays = rawJournalData.days;
        } else if (!isWholeJournalDraft && Array.isArray(rawJournalData.chapters)) {
            const grouped = {};
            rawJournalData.chapters.forEach(ch => {
                const d = ch.day || 'Day 01';
                if (!grouped[d]) grouped[d] = { day: d, dayTitle: ch.dayTitle || '', isFieldTest: !!ch.isFieldTest, chapters: [] };
                grouped[d].chapters.push(ch);
            });
            baseDays = Object.values(grouped);
        } else if (Array.isArray(rawItineraryData.days)) {
            baseDays = rawItineraryData.days.map(d => ({
                day: d.day,
                dayTitle: d.dayTitle || d.region || d.day,
                isDraft: isItemDraft(d),
                isFieldTest: false,
                chapters: (d.spots || []).map(sp => ({
                    id: sp.id, lat: sp.lat ?? fallbackCoord.lat, lng: sp.lng ?? fallbackCoord.lng,
                    zoom: 14, title: sp.spotName || sp.id, content: sp.intro || '', isDraft: isItemDraft(sp)
                }))
            }));
        }

        const mergedDays = baseDays.map((dayObj, dIdx) => {
            const itinDay = itinDayByName.get(dayObj.day) || rawItineraryData.days?.[dIdx];
            const dayRegion = dayObj.region || itinDay?.region || dayObj.dayTitle || '主要旅遊地區';
            const dayDraft = isItemDraft(dayObj) || isItemDraft(itinDay);

            const chapters = (dayObj.chapters || []).map((ch, cIdx) => {
                const indexedSp = itinDay?.spots?.[cIdx];
                const sp = (ch.id && itinSpotById.get(ch.id))
                    || (indexedSp && (!ch.id || !indexedSp.id || indexedSp.id === ch.id) ? indexedSp : null)
                    || {};
                const jCh = (ch.id && journalChapById.get(ch.id)) || {};

                // 分潤連結優先從「行程安排 (itinerary/*.json)」讀取；若行程未填有效網址，才退回讀取圖文遊記 (data/*.json)
                const itinAff = extractAffiliateList(sp);
                const chAff = extractAffiliateList(ch);
                const resolvedAffLinks = itinAff.length
                    ? itinAff
                    : (chAff.length ? chAff : extractAffiliateList(jCh));

                return {
                    ...jCh, ...ch, ...sp,
                    day: dayObj.day,
                    id: ch.id || sp.id || `d${dIdx + 1}-ch${cIdx + 1}`,
                    lat: ch.lat ?? sp.lat ?? jCh.lat, lng: ch.lng ?? sp.lng ?? jCh.lng, zoom: ch.zoom || sp.zoom || jCh.zoom || 14,
                    title: ch.title || sp.spotName || jCh.title || '', content: ch.content || sp.intro || '',
                    affiliateText: '',
                    affiliateUrl: '',
                    affiliateLinks: resolvedAffLinks,
                    country: sp.country || ch.country || itinDay?.country || rawItineraryData.country || '',
                    dayRegion, _isDraft: isItemDraft(ch) || isItemDraft(sp)
                };
            });

            return {
                ...dayObj,
                itinDayTitle: (itinDay?.dayTitle || dayObj.dayTitle || '').trim(),
                daySub: (itinDay?.daySub || dayObj.daySub || '').trim(),
                region: dayRegion,
                country: itinDay?.country || dayObj.country || '',
                _isDraft: dayDraft,
                chapters: isPreviewMode ? chapters : chapters.filter(c => !c._isDraft)
            };
        });

        normalizedDays = isPreviewMode ? mergedDays : mergedDays.filter(d => !d._isDraft && d.chapters.length > 0);

        const reqDayRaw = (urlParams.get('day') || '').trim();
        const matchedDay = reqDayRaw
            ? normalizedDays.find(d => d.day.toLowerCase() === reqDayRaw.toLowerCase())?.day
            : null;
        const initialDayKey = matchedDay || 'ALL';
        const reqView = urlParams.get('view');
        const reqSpot = (urlParams.get('spot') || '').trim();
        const resolvedViewId = reqView ? (reqView.startsWith('view-') ? reqView : `view-${reqView}`) : 'view-itinerary';

        initMap(normalizedDays, fallbackCoord);
        buildDayTabs();
        if (initialDayKey !== 'ALL') {
            document.querySelectorAll('.day-tab').forEach(b => b.classList.toggle('active', b.dataset.dayKey === initialDayKey));
        }
        renderDay(initialDayKey, Boolean(reqSpot));
        renderPackStaticViews();
        if (typeof loadCloudData === 'function') loadCloudData();
        refreshInfoStation(false);

        if (reqSpot) {
            focusSpotById(reqSpot, resolvedViewId);
        } else if (reqView && $(resolvedViewId)) {
            switchRightView(resolvedViewId);
        }
    }).catch(err => {
        $('itinerary-content').innerHTML = `<h2>糟糕，讀取失敗！</h2><p>${escHtml(err.message)}</p>`;
    });
}

document.addEventListener('DOMContentLoaded', bootJournalApp);

/* === 3. 視角切換與地圖顯示模式 === */
function switchRightView(viewId, shouldScrollTop = true) {
    document.querySelectorAll('.view-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
    document.querySelectorAll('.view-section').forEach(s => s.classList.toggle('active', s.id === viewId));
    $('day-tabs').style.display = (viewId === 'view-itinerary' || (viewId === 'view-journal' && !isWholeJournalDraft)) ? 'flex' : 'none';
    if (shouldScrollTop) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchPackSubTab(panelId, btnEl) {
    document.querySelectorAll('.pack-sub-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    else {
        const autoBtn = document.querySelector(`.pack-sub-btn[data-panel="${panelId}"]`);
        if (autoBtn) autoBtn.classList.add('active');
    }
    document.querySelectorAll('.pack-panel').forEach(p => p.classList.toggle('active', p.id === panelId));
}

function switchMapDisplayMode(mode) {
    $('btn-map-route').classList.toggle('active', mode === 'route');
    $('btn-map-explore').classList.toggle('active', mode === 'explore');
    if (mode === 'explore') {
        map.removeLayer(baseRouteLayer); map.removeLayer(activeRouteLayer); map.removeLayer(markersLayer);
        if (foxMarker) foxMarker.setOpacity(0);
        exploreStampsLayer.addTo(map);
    } else {
        map.removeLayer(exploreStampsLayer);
        baseRouteLayer.addTo(map); activeRouteLayer.addTo(map); markersLayer.addTo(map);
        if (foxMarker) foxMarker.setOpacity(1);
    }
}

/* === 4. 地圖初始化、交通判別與頭貼動畫 === */
function initMap(daysData, fallbackCoord) {
    const first = daysData?.[0]?.chapters?.[0];
    map = L.map('map', { zoomControl: false }).setView([first?.lat || fallbackCoord.lat, first?.lng || fallbackCoord.lng], first?.zoom || 7);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri', maxZoom: 16
    }).addTo(map);
    baseRouteLayer = L.layerGroup().addTo(map);
    activeRouteLayer = L.layerGroup().addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    exploreStampsLayer = L.layerGroup();
}

const buildAvatarInnerHTML = val => isMediaFile(val) ? `<img src="${normalizeMediaSrc(val)}" alt="旅人頭貼">` : (val || '🦊');

function getDistanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function resolveTransportMode(ch, distKm) {
    const raw = (ch.transport || '').toString().trim().toLowerCase();
    const aliases = {
        flight: ['flight', 'airplane', 'plane', '飛機', '航班'],
        hsr: ['hsr', 'shinkansen', 'ets', '高鐵', '新幹線'],
        train: ['train', 'jr', 'ktm', '火車', '台鐵', '鐵道', '電動列車'],
        metro: ['metro', 'mrt', 'subway', 'lrt', '捷運', '地鐵', '輕軌'],
        boat: ['boat', 'ferry', '遊船', '渡輪'],
        ropeway: ['ropeway', 'cable_car', '纜車'],
        walk: ['walk', 'foot', '步行', '散步'],
        drive: ['drive', 'car', 'taxi', 'grab', '自駕', '計程車', '專車', '包車'],
        bus: ['bus', '巴士', '公車', '客運']
    };
    for (const [k, list] of Object.entries(aliases)) if (list.includes(raw)) return k;

    const text = `${ch.title || ''} ${ch.spotName || ''} ${ch.routeFromTo || ''}`;
    if (distKm > 250 || /直飛|航班|班機|起飛|降落|AirAsia|亞航/i.test(text)) return 'flight';
    if (/遊船|觀光船|渡輪|乘船/.test(text)) return 'boat';
    if (/纜車|山頂站/.test(text)) return 'ropeway';
    if (/新幹線|高鐵|ETS/i.test(text)) return 'hsr';
    if (/JR|KTM|仙石線|奧羽本線|電鐵|Skyliner|火車|台鐵/i.test(text)) return 'train';
    if (/地鐵|捷運|Metro|MRT|LRT/i.test(text)) return 'metro';
    if (/包車|專車|Grab|計程車/i.test(text)) return 'drive';
    return distKm <= 3.5 ? 'walk' : 'bus';
}

function generateCurve(start, end, curvature = 0.15, segments = 32) {
    const [lat1, lng1] = start, [lat2, lng2] = end;
    const ctrlLat = (lat1 + lat2) / 2 - (lng2 - lng1) * curvature;
    const ctrlLng = (lng1 + lng2) / 2 + (lat2 - lat1) * curvature;
    return Array.from({ length: segments + 1 }, (_, i) => {
        const t = i / segments;
        return [
            Number(((1 - t) ** 2 * lat1 + 2 * (1 - t) * t * ctrlLat + t ** 2 * lat2).toFixed(5)),
            Number(((1 - t) ** 2 * lng1 + 2 * (1 - t) * t * ctrlLng + t ** 2 * lng2).toFixed(5))
        ];
    });
}

async function getDetailedPath(prevCh, currCh) {
    const cacheKey = `auto_v1_${prevCh.id}_to_${currCh.id}`;
    if (segmentCoordsCache[cacheKey]) return segmentCoordsCache[cacheKey];

    const start = [prevCh.lat, prevCh.lng], end = [currCh.lat, currCh.lng];
    const distKm = getDistanceKm(prevCh.lat, prevCh.lng, currCh.lat, currCh.lng);
    const mode = resolveTransportMode(currCh, distKm);

    if (CURVE_MODES[mode] !== undefined || distKm > 250) {
        return (segmentCoordsCache[cacheKey] = generateCurve(start, end, CURVE_MODES[mode] ?? 0.22, 36));
    }

    try {
        const saved = localStorage.getItem(cacheKey);
        if (saved) return (segmentCoordsCache[cacheKey] = JSON.parse(saved));
    } catch {}

    try {
        const profile = mode === 'walk' ? 'foot' : 'driving';
        const res = await fetch(`https://router.project-osrm.org/route/v1/${profile}/${prevCh.lng},${prevCh.lat};${currCh.lng},${currCh.lat}?overview=full&geometries=geojson`);
        const data = await res.json();
        if (data.code === 'Ok' && data.routes?.length) {
            const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            segmentCoordsCache[cacheKey] = coords;
            try { localStorage.setItem(cacheKey, JSON.stringify(coords)); } catch {}
            return coords;
        }
    } catch {}
    return (segmentCoordsCache[cacheKey] = generateCurve(start, end, 0.05, 24));
}

function drawActiveArrowRoute(coords) {
    activeRouteLayer.clearLayers();
    if (!coords || coords.length < 2) return;
    L.polyline(coords, { color: '#a6897c', weight: 3.5, opacity: 0.9, dashArray: '6, 8' }).addTo(activeRouteLayer);

    const arrowCount = Math.min(7, Math.max(2, Math.floor(coords.length / 6)));
    for (let k = 1; k <= arrowCount; k++) {
        const idx = Math.min(coords.length - 1, Math.floor((k / (arrowCount + 1)) * coords.length));
        const p1 = coords[idx - 1], p2 = coords[idx];
        if (!p1 || !p2) continue;
        const deg = Math.atan2(p2[0] - p1[0], p2[1] - p1[1]) * (180 / Math.PI);
        L.marker([(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2], {
            icon: L.divIcon({ className: 'route-arrow-icon', html: `<div class="route-arrow-inner" style="transform:rotate(${-deg}deg);">❯</div>`, iconSize: [14, 14], iconAnchor: [7, 7] }),
            interactive: false
        }).addTo(activeRouteLayer);
    }
}

function animateFoxAlongPath(coords, targetZoom = 14) {
    if (foxAnimFrame) cancelAnimationFrame(foxAnimFrame);
    if (!coords?.length) return;

    if (!foxMarker) {
        foxMarker = L.marker(coords[0], {
            icon: L.divIcon({ className: 'fox-traveler-icon', html: `<div class="fox-wrapper" id="fox-avatar">${buildAvatarInnerHTML(currentTripAvatar)}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] }),
            zIndexOffset: 2000
        }).addTo(map);
    } else {
        foxMarker.setLatLng(coords[0]);
    }

    if (coords.length === 1) { map.flyTo(coords[0], targetZoom, { animate: true, duration: 1.2 }); return; }

    const cumDist = [0];
    let totalDist = 0;
    for (let i = 1; i < coords.length; i++) {
        totalDist += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
        cumDist.push(totalDist);
    }
    if (!totalDist) { foxMarker.setLatLng(coords.at(-1)); map.flyTo(coords.at(-1), targetZoom, { animate: true, duration: 1 }); return; }

    map.flyToBounds(L.latLngBounds(coords), { padding: [70, 70], maxZoom: Math.max(targetZoom, 15), animate: true, duration: 0.7 });
    const avatarEl = $('fox-avatar');
    if (avatarEl) avatarEl.classList.add('walking');

    const startTime = performance.now(), duration = 1900;
    function step(now) {
        const p = Math.min(1, (now - startTime) / duration);
        const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const targetD = eased * totalDist;
        let idx = 0;
        while (idx < cumDist.length - 2 && cumDist[idx + 1] < targetD) idx++;
        const len = cumDist[idx + 1] - cumDist[idx], ratio = len > 0 ? (targetD - cumDist[idx]) / len : 0;
        const p1 = coords[idx], p2 = coords[idx + 1];

        foxMarker.setLatLng([p1[0] + (p2[0] - p1[0]) * ratio, p1[1] + (p2[1] - p1[1]) * ratio]);
        const av = $('fox-avatar');
        if (av && Math.abs(p2[1] - p1[1]) > 0.00001) av.style.transform = `scaleX(${(p2[1] - p1[1]) < 0 ? 1 : -1})`;

        if (p < 1) foxAnimFrame = requestAnimationFrame(step);
        else {
            if (av) av.classList.remove('walking');
            map.flyTo(coords.at(-1), targetZoom, { animate: true, duration: 0.9 });
        }
    }
    foxAnimFrame = requestAnimationFrame(step);
}

async function transitionToChapter(newIndex, animateFromPrevOrigin = false) {
    const target = currentChaptersList[newIndex];
    if (!target?.lat || !target?.lng) return;

    if (animateFromPrevOrigin && newIndex === 0 && prevDayOriginChapter) {
        const path = await getDetailedPath(prevDayOriginChapter, target);
        drawActiveArrowRoute(path);
        animateFoxAlongPath(path, target.zoom || 14);
    } else if (newIndex !== currentActiveIndex && Math.abs(newIndex - currentActiveIndex) === 1) {
        const from = currentChaptersList[currentActiveIndex], fwd = newIndex > currentActiveIndex;
        const raw = await getDetailedPath(fwd ? from : target, fwd ? target : from);
        const path = fwd ? raw : [...raw].reverse();
        drawActiveArrowRoute(path);
        animateFoxAlongPath(path, target.zoom || 14);
    } else {
        activeRouteLayer.clearLayers();
        if (newIndex > 0) {
            drawActiveArrowRoute(await getDetailedPath(currentChaptersList[newIndex - 1], target));
        } else if (newIndex === 0 && prevDayOriginChapter) {
            drawActiveArrowRoute(await getDetailedPath(prevDayOriginChapter, target));
        }
        animateFoxAlongPath([[target.lat, target.lng]], target.zoom || 14);
    }
    currentActiveIndex = newIndex;
}

function buildDayTabs() {
    const tabs = [{ key: 'ALL', label: '全部天數' }, ...normalizedDays.map(d => ({ key: d.day, label: (isPreviewMode && d._isDraft) ? `${d.day} (草稿)` : d.day }))];
    const box = $('day-tabs');
    box.innerHTML = '';
    tabs.forEach((tab, idx) => {
        const btn = document.createElement('button');
        btn.className = `day-tab ${idx === 0 ? 'active' : ''}`;
        btn.dataset.dayKey = tab.key;
        btn.textContent = tab.label;
        btn.onclick = () => {
            document.querySelectorAll('.day-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderDay(tab.key);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        box.appendChild(btn);
    });
}

/* === 5. 多媒體畫廊、預訂按鈕與燈箱（全面串接 Cloudflare R2） === */
const isMediaFile = s => typeof s === 'string' && /\.(jpeg|jpg|gif|png|webp|avif|svg|heic|mp4|mov|m4v|webm)(\?.*)?$/i.test(s.trim());
const isVideoFile = s => /\.(mp4|mov|m4v|webm)(\?.*)?$/i.test((s || '').trim());
function normalizeMediaSrc(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return s;
    const cleanPath = s.replace(/^\/+/, '');
    return `${R2_MEDIA_BASE}/${cleanPath}`;
}

function buildMediaHTML(ch, chIndex) {
    const items = [];
    if (isMediaFile(ch.mediaPlaceholder)) items.push({ src: normalizeMediaSrc(ch.mediaPlaceholder), caption: '' });
    (ch.mediaList || []).forEach(it => {
        const src = typeof it === 'string' ? it : (it?.src || it?.file || it?.url || '');
        if (isMediaFile(src)) items.push({ src: normalizeMediaSrc(src), caption: (typeof it === 'object' && it?.caption) || '' });
    });
    ch._mediaItems = items;
    if (!items.length) return ch.mediaPlaceholder ? `<div class="photo-placeholder">${ch.mediaPlaceholder}</div>` : '';

    const layout = ch.mediaLayout || 'auto';
    const cls = layout !== 'auto' ? `layout-${layout}` : (items.length === 1 ? 'layout-single' : (items.length <= 4 ? `layout-auto-${items.length}` : 'layout-carousel'));
    return `<div class="media-gallery ${cls}">${items.map((it, i) => {
        const cap = it.caption ? `<div class="media-caption">${it.caption}</div>` : '';
        return isVideoFile(it.src)
            ? `<div class="media-item"><video class="auto-video" src="${it.src}" muted loop playsinline preload="metadata" onclick="openLightbox(${chIndex},${i})"></video><button type="button" class="replay-btn" onclick="event.stopPropagation();replayVideo(this)">↻ 重播</button>${cap}</div>`
            : `<div class="media-item"><img src="${it.src}" alt="${escHtml(it.caption || ch.title)}" loading="lazy" onclick="openLightbox(${chIndex},${i})">${cap}</div>`;
    }).join('')}</div>`;
}

function extractAffiliateList(obj) {
    if (!obj) return [];
    const list = [], seen = new Set();
    const pushLink = (url, text) => {
        const cleanUrl = String(url || '').trim();
        if (!cleanUrl || seen.has(cleanUrl)) return;
        seen.add(cleanUrl);
        list.push({
            text: String(text || '').trim() || '🔗 查看同款行程與最新優惠',
            url: cleanUrl
        });
    };
    pushLink(obj.affiliateUrl, obj.affiliateText);
    if (Array.isArray(obj.affiliateLinks)) {
        obj.affiliateLinks.forEach(it => it && pushLink(it.url, it.text));
    }
    return list;
}

function buildAffiliateHTML(ch) {
    const links = extractAffiliateList(ch);
    if (!links.length) return '';
    return `<div class="affiliate-container">${links.map(l => `<a href="${escHtml(l.url)}" target="_blank" rel="noopener sponsored" class="affiliate-btn"><span>${escHtml(l.text)}</span><span>↗</span></a>`).join('')}</div>`;
}

function replayVideo(btn) { const v = btn.parentElement.querySelector('video'); if (v) { v.currentTime = 0; v.play(); } }
function initVideoAutoplay() {
    if (videoObserver) videoObserver.disconnect();
    videoObserver = new IntersectionObserver(entries => entries.forEach(e => {
        if (e.isIntersecting) { e.target.currentTime = 0; e.target.play().catch(() => {}); }
        else e.target.pause();
    }), { threshold: 0.45 });
    document.querySelectorAll('.auto-video').forEach(v => videoObserver.observe(v));
}

function openLightbox(chIndex, itemIdx = 0) {
    const ch = currentChaptersList[chIndex];
    if (!ch?._mediaItems?.length) return;
    lightboxItems = ch._mediaItems; lightboxIndex = itemIdx;
    updateLightboxContent();
    $('lightbox-overlay').style.display = 'flex';
}
function updateLightboxContent() {
    const item = lightboxItems[lightboxIndex]; if (!item) return;
    const multi = lightboxItems.length > 1;
    $('lightbox-prev').style.display = $('lightbox-next').style.display = multi ? 'flex' : 'none';
    $('lightbox-info').textContent = item.caption ? `${lightboxIndex + 1} / ${lightboxItems.length} ｜ ${item.caption}` : `${lightboxIndex + 1} / ${lightboxItems.length}`;
    $('lightbox-info').style.display = (multi || item.caption) ? 'block' : 'none';

    const img = $('lightbox-img'), vid = $('lightbox-video');
    if (isVideoFile(item.src)) {
        img.style.display = 'none'; img.src = '';
        vid.style.display = 'block'; vid.src = item.src; vid.currentTime = 0; vid.play().catch(() => {});
    } else {
        vid.pause(); vid.style.display = 'none'; vid.src = '';
        img.style.display = 'block'; img.src = item.src;
    }
}
function stepLightbox(dir) { if (lightboxItems.length > 1) { lightboxIndex = (lightboxIndex + dir + lightboxItems.length) % lightboxItems.length; updateLightboxContent(); } }
function handleOverlayClick() { if (!justSwiped) closeLightbox(); }
function closeLightbox() { $('lightbox-video').pause(); $('lightbox-video').src = ''; $('lightbox-overlay').style.display = 'none'; }

function initCoreEventListeners() {
    document.addEventListener('keydown', e => {
        if ($('lightbox-overlay')?.style.display === 'flex') {
            if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); }
            else if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
        } else if (e.key === 'Escape' && $('stamp-modal-overlay')?.classList.contains('open')) {
            if (typeof closeStampModal === 'function') closeStampModal();
        } else if (e.key === 'Escape' && $('booklet-modal-overlay')?.classList.contains('open')) {
            if (typeof closeBookletModal === 'function') closeBookletModal();
        }
    });

    const overlay = $('lightbox-overlay');
    if (overlay) {
        overlay.addEventListener('touchstart', e => { if (e.touches.length === 1) { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; } }, { passive: true });
        overlay.addEventListener('touchend', e => {
            if (lightboxItems.length <= 1 || !e.changedTouches.length) return;
            const dx = e.changedTouches[0].clientX - touchStartX, dy = e.changedTouches[0].clientY - touchStartY;
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
                justSwiped = true; setTimeout(() => { justSwiped = false; }, 300);
                stepLightbox(dx < 0 ? 1 : -1);
            }
        }, { passive: true });
    }

    document.querySelectorAll('#clip-cat-pills .clip-pill').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('#clip-cat-pills .clip-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); currentClipCategory = btn.dataset.cat; filterInfoClippings();
    }));
}

/* === 6. 章節與交通分類解析器 === */
function alignClock(raw, fb = '09:30') {
    const m = (raw || '').match(/(\d{1,2}):(\d{2})/);
    return m ? `${String(+m[1]).padStart(2, '0')}:${m[2]}` : (raw || fb);
}

function classifyChapterMeta(ch, idxInDay, prevCh) {
    const pureName = ch.spotName?.trim() || (ch.title || '').replace(/^\d+\.\s*/, '').replace(/^[^｜|]+[｜|]\s*/, '').trim();
    const defaultHours = ['08:30', '10:30', '12:30', '14:30', '16:30', '18:30', '20:30'];
    const timeStr = ch.time || defaultHours[Math.min(idxInDay, defaultHours.length - 1)];
    const categoryLabel = ch.categoryLabel || '經典必訪';

    let stampChar = '景', stampClass = 'spot';
    if (categoryLabel.includes('住宿') || /飯店|酒店|旅館|住宿|御宿野乃|Hotel|Stay|Méridien|Aloft|Holiday Inn|Village|APA/i.test(pureName)) {
        stampChar = '住'; stampClass = 'hotel';
    } else if (ch.isFood || categoryLabel.includes('美饌') || /餐廳|料理|茶室|茶餐室|白咖啡|肉骨茶|雞飯|娘惹|牛たん|牛舌|燒肉|真都|平田牧場|五十番|伊豆の華|音茶屋|山頭火|民福|謝朋殿|肉の|カフェ|咖啡|Cafe|Coffee/i.test(pureName)) {
        stampChar = '食'; stampClass = 'food';
    } else if (categoryLabel.includes('交通') || /機場|新幹線|車站|轉乘|Skyliner|ETS|KTM|KLIA|包車|專車/i.test(pureName)) {
        stampChar = '驛'; stampClass = 'transit';
    }

    const introText = ch.intro?.trim() || `【${pureName}】為本段行程之重要參訪據點（座標：${Number(ch.lat).toFixed(4)}, ${Number(ch.lng).toFixed(4)}）。`;
    const noteText = ch.note?.trim() || `• 出發前建議確認【${pureName}】最新營業時間與公休日。\n• 若涉及門票、車票或熱門時段入場，建議提前預訂並預留緩衝時間。`;

    let transitInfo = null;
    if ((prevCh?.lat && ch.lat) || ch.routeFromTo || ch.transitMins !== undefined || ch.transitCost !== undefined) {
        const distKm = (prevCh?.lat && ch.lat) ? getDistanceKm(prevCh.lat, prevCh.lng, ch.lat, ch.lng) : 10;
        const mode = resolveTransportMode(ch, distKm);
        const modeMap = {
            flight:  { icon: '✈️', name: '國際航班', mins: 210, cost: 8500 },
            hsr:     { icon: '🚄', name: '高速鐵路 / ETS', mins: Math.max(45, Math.round(distKm * 0.45)), cost: Math.round(distKm * 32) },
            train:   { icon: '🚃', name: '鐵道列車', mins: Math.max(20, Math.round(distKm * 1.1)), cost: Math.max(240, Math.round(distKm * 22)) },
            metro:   { icon: '🚇', name: '地鐵 / 捷運', mins: 18, cost: 210 },
            ropeway: { icon: '🚡', name: '山岳纜車', mins: 20, cost: 3800 },
            boat:    { icon: '⛴️', name: '觀光遊船', mins: 50, cost: 1500 },
            bus:     { icon: '🚌', name: '路線 / 高速巴士', mins: Math.max(20, Math.round(distKm * 1.6)), cost: Math.max(500, Math.round(distKm * 45)) },
            drive:   { icon: '🚕', name: '專車 / 包車 / Grab', mins: Math.max(15, Math.round(distKm * 1.3)), cost: Math.max(1200, Math.round(distKm * 300)) },
            walk:    { icon: '🚶', name: '漫步前往', mins: Math.max(5, Math.round(distKm * 12)), cost: 0 }
        };
        const picked = modeMap[mode] || modeMap.bus;
        const prevPure = prevCh ? (prevCh.spotName || (prevCh.title || '').replace(/^\d+\.\s*/, '').replace(/^[^｜|]+[｜|]\s*/, '')).trim() : '起始站';
        const alignedClock = alignClock(timeStr);

        transitInfo = {
            mode, icon: picked.icon, modeName: picked.name,
            routeText: ch.routeFromTo?.trim() || `${prevPure} → ${pureName}`,
            alignedClock,
            timeRange: ch.scheduleTime || `${alignedClock} 發車`,
            seatType: ch.seatType || ((mode === 'hsr' || mode === 'flight') ? '💺 對號指定席' : '🚌 依班次運行'),
            mins: ch.transitMins !== undefined ? Number(ch.transitMins) : picked.mins,
            cost: ch.transitCost !== undefined ? Number(ch.transitCost) : picked.cost,
            timetableUrl: ch.timetableUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pureName)}`,
            timetableLabel: ch.timetableLabel || '查看時刻表與路線'
        };
    }

    return {
        stampChar, stampClass, pureName, categoryLabel, timeStr, transitInfo, introText, noteText,
        isFoodSpot: Boolean(ch.isFood || stampChar === '食'),
        foodReview: ch.foodReview?.trim() || `🤖 【AI 美味預覽】「${pureName}」為當地代表性風味餐點，實際用餐後可於 /admin/ 後台更新實測心得。`,
        foodPolicy: ch.foodPolicy?.trim() || `• 建議留意熱門時段是否需預約、每人低消與現場支援之支付方式。`
    };
}

/* === 7. 渲染行程安排與圖文遊記（含雙視角滾動連動地圖） === */
function setActiveSpotFocus(chIndex, activeMarker) {
    // 1. 遊記章節高亮
    document.querySelectorAll('.chapter').forEach(c => c.classList.toggle('active', Number(c.dataset.index) === chIndex));
    // 2. 行程卡片高亮（只亮外框，不自動開合避免版面跳動）
    document.querySelectorAll('.spot-intro-card').forEach(c => c.classList.toggle('map-focused', Number(c.dataset.index) === chIndex));
    // 3. 左側地圖圓點高亮
    document.querySelectorAll('.custom-marker').forEach(el => el.classList.remove('active'));
    const marker = activeMarker || chapterIndexMarkers.get(chIndex);
    marker?.getElement()?.classList.add('active');
}

function setActiveChapter(sec, activeMarker) {
    const idx = sec ? parseInt(sec.dataset.index, 10) : -1;
    if (!isNaN(idx) && idx >= 0) {
        setActiveSpotFocus(idx, activeMarker || chapterMarkers.get(sec));
        return;
    }
    document.querySelectorAll('.chapter').forEach(c => c.classList.remove('active'));
    if (sec) sec.classList.add('active');
    document.querySelectorAll('.custom-marker').forEach(el => el.classList.remove('active'));
    (activeMarker || chapterMarkers.get(sec))?.getElement()?.classList.add('active');
}

function handleSpotCardHeaderClick(headerEl, chIndex) {
    headerEl.parentElement.classList.toggle('open');
    setActiveSpotFocus(chIndex);
    focusSpotOnMap(chIndex);
}

function jumpToJournalChapter(chIndex, sectionId) {
    switchRightView('view-journal');
    setTimeout(() => {
        const sec = $(sectionId);
        if (!sec) return;
        isClickScrolling = true;
        clearTimeout(scrollUnlockTimer);
        setActiveSpotFocus(chIndex);
        transitionToChapter(chIndex);
        const navBottom = document.querySelector('.top-nav')?.getBoundingClientRect().bottom || 0;
        window.scrollTo({ top: Math.max(0, window.pageYOffset + sec.getBoundingClientRect().top - navBottom - 20), behavior: 'smooth' });
        scrollUnlockTimer = setTimeout(() => { isClickScrolling = false; }, 1000);
    }, 80);
}
const focusSpotOnMap = chIndex => transitionToChapter(chIndex);

function focusSpotById(spotId, preferViewId = 'view-itinerary') {
    if (!spotId) return;
    let chIndex = currentChaptersList.findIndex(c => c.id === spotId);
    if (chIndex < 0 && currentDayKey !== 'ALL') {
        document.querySelectorAll('.day-tab').forEach(b => b.classList.toggle('active', b.dataset.dayKey === 'ALL'));
        renderDay('ALL', true);
        chIndex = currentChaptersList.findIndex(c => c.id === spotId);
    }
    if (chIndex < 0) {
        if (currentChaptersList.length) transitionToChapter(0, Boolean(prevDayOriginChapter));
        return;
    }

    const useJournal = (preferViewId === 'view-journal') && !isWholeJournalDraft;
    switchRightView(useJournal ? 'view-journal' : 'view-itinerary', false);

    setTimeout(() => {
        isClickScrolling = true;
        clearTimeout(scrollUnlockTimer);
        setActiveSpotFocus(chIndex);
        transitionToChapter(chIndex);

        const navBottom = document.querySelector('.top-nav')?.getBoundingClientRect().bottom || 0;
        if (useJournal) {
            const sec = $(`section-${spotId}`);
            if (sec) {
                window.scrollTo({ top: Math.max(0, window.pageYOffset + sec.getBoundingClientRect().top - navBottom - 20), behavior: 'smooth' });
            }
        } else {
            document.querySelectorAll('.spot-intro-card.open').forEach(c => c.classList.remove('open'));
            const card = $(`itin-card-${spotId}`);
            if (card) {
                card.classList.add('open');
                window.scrollTo({ top: Math.max(0, window.pageYOffset + card.getBoundingClientRect().top - navBottom - 16), behavior: 'smooth' });
            }
        }
        scrollUnlockTimer = setTimeout(() => { isClickScrolling = false; }, 1100);
    }, 120);
}

function renderDay(dayKey, skipInitialFocus = false) {
    currentDayKey = dayKey;
    const contentDiv = $('content'), itinDiv = $('itinerary-content');
    contentDiv.innerHTML = ''; itinDiv.innerHTML = '';
    if (observer) observer.disconnect();
    if (itinObserver) itinObserver.disconnect();
    markersLayer.clearLayers(); baseRouteLayer.clearLayers(); activeRouteLayer.clearLayers(); exploreStampsLayer.clearLayers();
    chapterMarkers.clear(); chapterIndexMarkers.clear();

    const dotIcon = L.divIcon({ className: 'custom-marker', html: '<div class="marker-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
    currentChaptersList = []; currentActiveIndex = 0;
    prevDayOriginChapter = null;
    const simpleLatLngs = [];
    let spotCount = 0;
    const uniqueHotels = new Set();

    const daysToRender = dayKey === 'ALL' ? normalizedDays : normalizedDays.filter(d => d.day === dayKey);

    if (isWholeJournalDraft) {
        contentDiv.innerHTML = `<div class="draft-empty-box"><div style="font-size:2rem;margin-bottom:8px;">✍️</div><div style="font-weight:700;color:var(--accent-brown-dark);font-size:1.05rem;margin-bottom:6px;">這趟旅程的圖文遊記尚在整理中</div><p style="margin:0;font-size:0.9rem;">目前已開放「📅 行程安排」、「📡 資訊情報」與「🎫 票券蒐集」完整規劃內容。<br>待完稿並將 <code>data/${escHtml(tripId)}.json</code> 的 <code>isDraft</code> 改為 <code>false</code> 後即可閱覽。</p></div>`;
    }
    if (!daysToRender.length) {
        itinDiv.innerHTML = `<div class="draft-empty-box">✨ 目前尚無公開的行程天數（編輯中可於網址加上 <code>&preview=1</code> 預覽草稿）。</div>`;
        $('map-stats-pill').textContent = '0 日行跡';
        return;
    }

    // 行程頂部預留低調的隨手記與集章解鎖狀態條（由 journal-cloud.js 填寫內容）
    const unlockSlot = document.createElement('div');
    unlockSlot.id = 'itin-unlock-bar';
    itinDiv.appendChild(unlockSlot);

    // 單日視角時，自動抓取前一天最後一個有效站點當出發起點（相距 < 20 公尺則略過避免重疊）
    if (dayKey !== 'ALL') {
        const curDayIdx = normalizedDays.findIndex(d => d.day === dayKey);
        const firstTodayCh = daysToRender[0]?.chapters?.find(c => c.lat && c.lng);
        if (curDayIdx > 0 && firstTodayCh) {
            for (let i = curDayIdx - 1; i >= 0; i--) {
                const prevValid = [...(normalizedDays[i].chapters || [])].reverse().find(c => c.lat && c.lng);
                if (prevValid) {
                    if (getDistanceKm(prevValid.lat, prevValid.lng, firstTodayCh.lat, firstTodayCh.lng) >= 0.02) {
                        prevDayOriginChapter = { ...prevValid, _fromDay: normalizedDays[i].day };
                        simpleLatLngs.push([prevValid.lat, prevValid.lng]);
                        const originName = prevValid.spotName?.trim() || (prevValid.title || '').replace(/^\d+\.\s*/, '').replace(/^[^｜|]+[｜|]\s*/, '').trim();
                        const originIcon = L.divIcon({ className: 'prev-origin-marker', html: '<div class="prev-origin-dot"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
                        L.marker([prevValid.lat, prevValid.lng], { icon: originIcon })
                            .bindTooltip(`前日出發 (${normalizedDays[i].day})｜${originName}`, { direction: 'top', offset: [0, -8], className: 'marker-tooltip' })
                            .addTo(markersLayer);
                    }
                    break;
                }
            }
        }
    }

    daysToRender.forEach(dayObj => {
        if (!isWholeJournalDraft) {
            const banner = document.createElement('div');
            banner.className = 'day-banner';
            banner.innerHTML = `
                <div class="day-banner-header">
                    <div class="day-badge">${escHtml(dayObj.day)}</div>
                    ${dayObj.isFieldTest ? '<span class="field-test-badge">行程實測</span>' : ''}
                    ${(isPreviewMode && dayObj._isDraft) ? '<span class="draft-preview-badge">📝 草稿預覽</span>' : ''}
                </div>
                <h1>${escHtml(dayObj.dayTitle || dayObj.day)}</h1>`;
            contentDiv.appendChild(banner);
        }

        let dayMins = 0, dayCost = 0;
        const dayCardsHTML = [], spotNames = [];

        (dayObj.chapters || []).forEach((ch, idxInDay) => {
            const chIndex = currentChaptersList.length;
            const meta = classifyChapterMeta(ch, idxInDay, idxInDay > 0 ? dayObj.chapters[idxInDay - 1] : null);
            ch._pureName = meta.pureName;
            ch._dayKey = dayObj.day;
            ch._categoryLabel = meta.categoryLabel;
            ch._isFoodSpot = meta.isFoodSpot;
            ch._region = ch.dayRegion || dayObj.region || '';
            ch._country = ch.country || dayObj.country || rawItineraryData.country || '';
            currentChaptersList.push(ch);

            if (meta.stampChar === '住') {
                const hotelKey = (ch.lat && ch.lng)
                    ? `${Number(ch.lat).toFixed(4)},${Number(ch.lng).toFixed(4)}`
                    : meta.pureName.replace(/\bcheck-?(in|out)\b/gi, '').trim().toLowerCase();
                uniqueHotels.add(hotelKey);
            } else {
                spotCount++;
            }
            spotNames.push(meta.pureName);

            let section = null;
            if (!isWholeJournalDraft) {
                section = document.createElement('section');
                section.className = `chapter ${chIndex === 0 ? 'active' : ''}`;
                section.id = `section-${ch.id}`;
                section.dataset.index = chIndex;
                section.innerHTML = `
                    <h2>${ch.title}${(isPreviewMode && ch._isDraft) ? '<span style="font-size:0.75rem;background:#B84A39;color:#fff;padding:2px 8px;border-radius:8px;margin-left:8px;">📝 草稿</span>' : ''}</h2>
                    ${buildMediaHTML(ch, chIndex)}
                    <div class="chapter-body">${ch.content || ''}</div>
                    ${buildAffiliateHTML(ch)}`;
                contentDiv.appendChild(section);
            }

            if (meta.transitInfo && idxInDay > 0 && meta.transitInfo.mode !== 'flight') {
                const segCostTwd = toTwd(meta.transitInfo.cost, ch.transitCurrency);
                dayMins += meta.transitInfo.mins; dayCost += segCostTwd;
                dayCardsHTML.push(`
                    <div class="itin-transit-row">
                        <div class="itin-transit-left"><span class="itin-transit-icon">${meta.transitInfo.icon}</span><span>${escHtml(meta.transitInfo.modeName)}｜${escHtml(meta.transitInfo.routeText)}</span></div>
                        <div class="itin-transit-right">${meta.transitInfo.mins} 分 &nbsp; NT$${segCostTwd.toLocaleString()}</div>
                    </div>`);
            }

            const gmapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meta.pureName)}`;
            dayCardsHTML.push(`
                <div class="spot-intro-card ${idxInDay === 0 ? 'open' : ''} ${chIndex === 0 ? 'map-focused' : ''}"
                     id="itin-card-${escHtml(ch.id)}"
                     data-index="${chIndex}"
                     data-lat="${ch.lat ?? ''}"
                     data-lng="${ch.lng ?? ''}"
                     data-zoom="${ch.zoom || 14}"
                     data-spot-key="${escHtml(normalizeSpotKey(dayObj.day, meta.pureName))}">
                    <div class="spot-card-header" onclick="handleSpotCardHeaderClick(this, ${chIndex});">
                        <div class="spot-header-left">
                            <span class="spot-time-box">${escHtml(meta.timeStr)}</span>
                            <span class="spot-cat-pill">${escHtml(meta.categoryLabel)}</span>
                            <span class="spot-title-text">${escHtml(meta.pureName)}</span>
                            <span class="spot-star-slot" id="spot-star-slot-${chIndex}"></span>
                            <span class="spot-stamp-slot" id="spot-stamp-slot-${chIndex}"></span>
                        </div>
                        <span class="spot-toggle-arrow">▶</span>
                    </div>
                    <div class="spot-card-body">
                        <div class="spot-sub-block intro-block"><div class="spot-sub-title">📘 景點介紹</div><p class="spot-sub-text">${escHtml(meta.introText)}</p></div>
                        <div class="spot-sub-block note-block"><div class="spot-sub-title">⚠️ 注意事項＆攻略備註</div><p class="spot-sub-text">${escHtml(meta.noteText)}</p></div>
                        <div class="spot-action-pills">
                            <a href="${gmapUrl}" target="_blank" rel="noopener" class="spot-pill-btn">🗺️ Google 地圖導航</a>
                            <button type="button" class="spot-pill-btn loc" onclick="setActiveSpotFocus(${chIndex});focusSpotOnMap(${chIndex});">📍 地圖定位</button>
                            <button type="button" class="spot-pill-btn note-btn" onclick="openSpotNoteEditorByIndex(${chIndex})">📝 寫隨手記 / ⭐ 評分</button>
                            <button type="button" class="spot-pill-btn stamp-btn" id="spot-stamp-btn-${chIndex}" onclick="openSpotStampModal(${chIndex})">💮 收集景點章</button>
                            ${!isWholeJournalDraft ? `<button type="button" class="spot-pill-btn loc" onclick="jumpToJournalChapter(${chIndex},'section-${escHtml(ch.id)}')">📖 看實拍遊記</button>` : ''}
                        </div>
                        <div class="spot-notes-mount" id="spot-notes-mount-${chIndex}"></div>
                        ${buildAffiliateHTML(ch)}
                    </div>
                </div>`);

            if (ch.lat && ch.lng) {
                simpleLatLngs.push([ch.lat, ch.lng]);
                const marker = L.marker([ch.lat, ch.lng], { icon: dotIcon }).addTo(markersLayer);
                marker.bindTooltip(`${dayObj.day}｜${meta.pureName}`, { direction: 'top', offset: [0, -10], className: 'marker-tooltip' });

                marker.on('click', () => {
                    isClickScrolling = true; clearTimeout(scrollUnlockTimer);
                    setActiveSpotFocus(chIndex, marker);
                    transitionToChapter(chIndex);
                    if ($('view-journal').classList.contains('active') && section) {
                        const navBottom = document.querySelector('.top-nav')?.getBoundingClientRect().bottom || 0;
                        window.scrollTo({ top: Math.max(0, window.pageYOffset + section.getBoundingClientRect().top - navBottom - 20), behavior: 'smooth' });
                    } else {
                        const card = $(`itin-card-${ch.id}`);
                        if (card) { card.classList.add('open'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                    }
                    scrollUnlockTimer = setTimeout(() => { isClickScrolling = false; }, 950);
                });

                chapterIndexMarkers.set(chIndex, marker);
                if (section) chapterMarkers.set(section, marker);

                const stamp = L.marker([ch.lat, ch.lng], {
                    icon: L.divIcon({ className: 'stamp-marker', html: `<div class="stamp-box ${meta.stampClass}">${meta.stampChar}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })
                }).addTo(exploreStampsLayer);
                stamp.bindTooltip(`[${meta.stampChar}] ${meta.pureName}`, { direction: 'top', offset: [0, -12], className: 'marker-tooltip' });
                stamp.on('click', () => marker.fire('click'));
            }
        });

        const hrs = Math.floor(dayMins / 60), mins = dayMins % 60;
        const block = document.createElement('div');
        block.className = 'itinerary-day-block';
        block.innerHTML = `
            <div class="itin-day-header">
                <h3 class="itin-day-title">${escHtml(dayObj.day)}｜${escHtml(dayObj.itinDayTitle || dayObj.dayTitle || '')}</h3>
                <div class="itin-day-sub">📅 ${escHtml(dayObj.daySub || spotNames.join(' · '))}</div>
            </div>
            <div class="itin-summary-box">
                <div class="itin-sum-col"><div class="itin-sum-label">當日區域移動時間</div><div class="itin-sum-val">${hrs > 0 ? `${hrs} 時 ${mins} 分` : `${mins} 分`}</div></div>
                <div class="itin-sum-col"><div class="itin-sum-label">預估區域交通花費</div><div class="itin-sum-val cost">NT$${dayCost.toLocaleString()}</div></div>
            </div>
            ${dayCardsHTML.join('')}`;
        itinDiv.appendChild(block);
    });

    $('map-stats-pill').textContent = `${daysToRender.length} 日行跡・${spotCount} 處尋訪・${uniqueHotels.size} 處住宿點`;
    if (simpleLatLngs.length > 1) L.polyline(simpleLatLngs, { color: '#C4A99E', weight: 2, opacity: 0.45, dashArray: '5, 10' }).addTo(baseRouteLayer);
    if (currentChaptersList.length) {
        setActiveSpotFocus(0);
        if (!skipInitialFocus) transitionToChapter(0, Boolean(prevDayOriginChapter));
    }

    // 行程安排專用滾動監聽器（滾動行程卡片同步移動左側地圖，不自動開合卡片）
    itinObserver = new IntersectionObserver(entries => {
        if (isClickScrolling) return;
        if (!$('view-itinerary')?.classList.contains('active')) return;
        for (const e of entries) {
            if (e.isIntersecting) {
                const idx = parseInt(e.target.dataset.index, 10);
                if (!isNaN(idx) && idx !== currentActiveIndex) {
                    setActiveSpotFocus(idx);
                    transitionToChapter(idx);
                }
                break;
            }
        }
    }, { rootMargin: '-32% 0px -56% 0px', threshold: 0 });
    document.querySelectorAll('.spot-intro-card').forEach(c => itinObserver.observe(c));

    // 圖文遊記專用滾動監聽器
    if (!isWholeJournalDraft) {
        observer = new IntersectionObserver(entries => {
            if (isClickScrolling) return;
            if (!$('view-journal')?.classList.contains('active')) return;
            entries.forEach(e => {
                if (e.isIntersecting) {
                    const idx = parseInt(e.target.dataset.index, 10);
                    setActiveSpotFocus(idx);
                    if (!isNaN(idx) && idx !== currentActiveIndex) transitionToChapter(idx);
                }
            });
        }, { rootMargin: '-35% 0px -55% 0px', threshold: 0 });
        document.querySelectorAll('.chapter').forEach(c => observer.observe(c));
        initVideoAutoplay();
    }

    // 若雲端隨手記與印章已載入，立即同步渲染到新建立的行程卡片上
    if (typeof refreshItinerarySpotNotes === 'function') refreshItinerarySpotNotes();
    if (typeof refreshItinerarySpotStamps === 'function') refreshItinerarySpotStamps();
}

/* === 8. 📡 資訊情報引擎（出發前 3 天～旅程結束日才啟動即時抓取） === */
function getInfoWindowState() {
    const now = new Date();
    if (currentTripEndDate) {
        const endWindow = new Date(`${currentTripEndDate}T23:59:59`);
        if (!isNaN(endWindow) && now > endWindow) return { status: 'ended', openDateStr: '', startWindow: null, endWindow };
    }
    if (currentTripStartDate) {
        const startDay = new Date(`${currentTripStartDate}T00:00:00`);
        if (!isNaN(startDay)) {
            const startWindow = new Date(startDay.getTime() - 3 * 86400000);
            const openDateStr = `${startWindow.getFullYear()}-${String(startWindow.getMonth() + 1).padStart(2, '0')}-${String(startWindow.getDate()).padStart(2, '0')}`;
            const endWindow = currentTripEndDate ? new Date(`${currentTripEndDate}T23:59:59`) : null;
            if (!isPreviewMode && now < startWindow) return { status: 'upcoming', openDateStr, startWindow, endWindow };
            return { status: 'active', openDateStr, startWindow, endWindow };
        }
    }
    return { status: 'active', openDateStr: '', startWindow: null, endWindow: null };
}

async function fetchLiveTravelNews(dayCoords, winState) {
    const customKw = Array.isArray(rawItineraryData.newsKeywords) ? rawItineraryData.newsKeywords.filter(Boolean) : [];
    const regionNames = [...new Set(dayCoords.map(d => d.locName).filter(r => r && r !== '主要旅遊'))];
    const cleanTitle = (rawItineraryData.tripTitle || rawJournalData.tripTitle || '').split('｜').pop().trim();
    const queryRaw = customKw.length
        ? customKw.slice(0, 3).join(' OR ')
        : (regionNames.length ? `(${regionNames.slice(0, 3).join(' OR ')}) (旅遊 OR 交通 OR 天氣 OR 入境)` : `${cleanTitle || '旅遊'} 交通 天氣`);

    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(queryRaw)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    try {
        const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`);
        const data = await res.json();
        if (data?.status === 'ok' && Array.isArray(data.items)) {
            return data.items
                .filter(item => {
                    if (isPreviewMode || !winState.startWindow || !item.pubDate) return true;
                    const pubTime = new Date(item.pubDate.replace(' ', 'T') + 'Z');
                    return isNaN(pubTime) || (pubTime >= winState.startWindow && (!winState.endWindow || pubTime <= winState.endWindow));
                })
                .slice(0, 8)
                .map(item => {
                    const title = (item.title || '').replace(/\s*-\s*[^-]+$/, '').trim();
                    const matchedRegion = dayCoords.find(d => title.includes(d.locName))?.stdRegion || dayCoords[0]?.stdRegion || '當地快訊';
                    let category = '快訊', urgent = false;
                    if (/雨|颱風|氣象|氣溫|雷暴|熱浪|淹水|大雪/.test(title)) { category = '天氣'; urgent = /警報|暴雨|淹水|停飛|暴雪/.test(title); }
                    else if (/捷運|地鐵|火車|列車|航班|機場|塞車|新幹線|MRT|KTM|ETS|Grab/i.test(title)) { category = '交通'; urgent = /停駛|延誤|故障|中斷|取消/.test(title); }
                    else if (/地震|災害|警告|治安|詐騙|入境|簽證|MDAC/i.test(title)) { category = '防災'; urgent = true; }
                    return {
                        id: `rss-${btoa(unescape(encodeURIComponent(title.slice(0, 24)))).slice(0, 16)}`,
                        category, region: matchedRegion, urgent,
                        tag: item.author || '即時新聞快訊', title,
                        desc: `發布時間：${(item.pubDate || '').slice(0, 16)}（點擊標題查看完整報導）`,
                        link: item.link || ''
                    };
                });
        }
    } catch {}
    return [];
}

async function refreshInfoStation(isManualClick = false) {
    const winState = getInfoWindowState();
    const refreshBtn = $('btn-refresh-info'), liveDot = $('info-live-dot');
    const mainTitle = rawItineraryData.tripTitle || rawJournalData.tripTitle || '旅途';
    $('info-trip-code').textContent = `${tripId.toUpperCase()} ・ 旅の速報`;
    $('info-station-title').textContent = `${mainTitle.split('｜').pop().trim()}情報手帳`;

    const dayCoords = normalizedDays.map((d, idx) => {
        const valid = (d.chapters || []).filter(c => c.lat && c.lng && !(c.lat < 25.5 && c.lat > 21.5 && c.lng > 119.5 && c.lng < 122.5));
        const picked = valid[Math.floor(valid.length / 2)] || d.chapters?.[0] || { lat: 3.1390, lng: 101.6869 };
        const stdRegion = d.region || d.dayTitle || d.day;
        const locName = stdRegion.replace(/地區/g, '').split(/[・｜|]/).pop().trim() || d.day;
        return { dayKey: d.day, dayCode: `D${String(idx + 1).padStart(2, '0')}`, stdRegion, locName, lat: Number(picked.lat).toFixed(3), lng: Number(picked.lng).toFixed(3) };
    });

    const staticNews = Array.isArray(rawItineraryData.urgentNews) ? rawItineraryData.urgentNews : [];

    if (winState.status === 'upcoming') {
        liveDot.classList.add('ended'); liveDot.style.background = '#D69E2E';
        $('info-conn-label').textContent = '行前待命中';
        $('info-update-time').textContent = `將於出發前 3 天（${winState.openDateStr}）自動開啟抓取`;
        refreshBtn.textContent = '⏳ 尚未開放抓取'; refreshBtn.disabled = true;
        $('clip-archive-badge').textContent = `⏳ 預計 ${winState.openDateStr} 啟用即時連線`;

        const items = [`<li><span>⏳</span><div><strong>【情報站尚未啟動】</strong>即時氣象與當地快訊將於出發前 3 天（<strong>${winState.openDateStr}</strong>）自動連線啟用。</div></li>`];
        staticNews.slice(0, 4).forEach(n => items.push(`<li><span>📌</span><div><strong>${escHtml(n.title)}：</strong>${escHtml(n.desc)}</div></li>`));
        $('info-quick-five').innerHTML = items.join('');

        $('info-radar-grid').innerHTML = dayCoords.map(item => {
            const wcUrl = `https://weather.com/zh-TW/weather/today/l/${item.lat},${item.lng}`;
            const windyUrl = `https://www.windy.com/${item.lat}/${item.lng}?wind,${item.lat},${item.lng},11`;
            return `<div class="radar-cell"><a href="${wcUrl}" target="_blank" rel="noopener" class="radar-main-link"><div class="radar-day-num">${item.dayCode}・${escHtml(item.locName)}</div><div class="radar-day-status">⏳ ${winState.openDateStr} 開放</div></a><div class="radar-ext-links"><a href="${wcUrl}" target="_blank" rel="noopener" class="radar-ext-a">🌤️ Weather</a><a href="${windyUrl}" target="_blank" rel="noopener" class="radar-ext-a">🌬️ Windy</a></div></div>`;
        }).join('');
        updateAndRenderCumulativeClippings(dayCoords, [], winState);
        return;
    }

    if (winState.status === 'ended') {
        liveDot.classList.add('ended'); liveDot.style.background = '';
        $('info-conn-label').textContent = '歷史封存';
        $('info-update-time').textContent = `旅程已於 ${currentTripEndDate} 結束（停止更新）`;
        refreshBtn.textContent = '🏁 旅程已結束'; refreshBtn.disabled = true;
        $('clip-archive-badge').textContent = `🔒 已於 ${currentTripEndDate} 封存`;

        const items = [`<li><span>🏁</span><div><strong>【旅程已結束並封存】</strong>即時連線已於 ${currentTripEndDate} 停止，下方保留當時累積的情報剪報。</div></li>`];
        staticNews.slice(0, 4).forEach(n => items.push(`<li><span>📌</span><div><strong>${escHtml(n.title)}：</strong>${escHtml(n.desc)}</div></li>`));
        $('info-quick-five').innerHTML = items.join('');

        $('info-radar-grid').innerHTML = dayCoords.map(item => {
            const wcUrl = `https://weather.com/zh-TW/weather/today/l/${item.lat},${item.lng}`;
            const windyUrl = `https://www.windy.com/${item.lat}/${item.lng}?wind,${item.lat},${item.lng},11`;
            return `<div class="radar-cell"><a href="${wcUrl}" target="_blank" rel="noopener" class="radar-main-link"><div class="radar-day-num">${item.dayCode}・${escHtml(item.locName)}</div><div class="radar-day-status">🏁 歷史封存</div></a><div class="radar-ext-links"><a href="${wcUrl}" target="_blank" rel="noopener" class="radar-ext-a">🌤️ Weather</a><a href="${windyUrl}" target="_blank" rel="noopener" class="radar-ext-a">🌬️ Windy</a></div></div>`;
        }).join('');
        updateAndRenderCumulativeClippings(dayCoords, [], winState);
        return;
    }

    liveDot.classList.remove('ended'); liveDot.style.background = '';
    $('info-conn-label').textContent = isPreviewMode ? '預覽測試連線' : '即時連線';
    refreshBtn.disabled = false;
    if (isManualClick) refreshBtn.textContent = '↻ 連線更新中...';

    let timeStr = '';
    try { timeStr = new Intl.DateTimeFormat('zh-TW', { timeZone: currentTripTimezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
    catch { timeStr = new Date().toTimeString().slice(0, 5); }
    $('info-update-time').textContent = `更新：當地時間 ${timeStr}`;
    $('clip-archive-badge').textContent = '🟢 旅途即時累積中（自動過濾重複）';

    const [, liveNews] = await Promise.all([
        Promise.all(dayCoords.map(async item => {
            try {
                const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${item.lat}&longitude=${item.lng}&current=temperature_2m,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`);
                const w = await res.json();
                if (w?.current) {
                    liveWeatherByDay[item.dayCode] = {
                        ...item,
                        maxT: Math.round(w.daily?.temperature_2m_max?.[0] ?? w.current.temperature_2m),
                        minT: Math.round(w.daily?.temperature_2m_min?.[0] ?? w.current.temperature_2m - 4),
                        rainProb: w.daily?.precipitation_probability_max?.[0] ?? 10,
                        wind: Math.round(w.current.wind_speed_10m || 8)
                    };
                    return;
                }
            } catch {}
            liveWeatherByDay[item.dayCode] = { ...item, maxT: 26, minT: 20, rainProb: 20, wind: 10 };
        })),
        fetchLiveTravelNews(dayCoords, winState)
    ]);

    const d1W = liveWeatherByDay['D01'] || { locName: '首站', maxT: 26, minT: 20, rainProb: 20, wind: 10 };
    const d2W = liveWeatherByDay['D02'] || d1W;
    const quickList = [
        `<li><span>☀️</span><div><strong>【${escHtml(d1W.locName)} D01 即時氣象】</strong>氣溫 ${d1W.maxT}~${d1W.minT}°C，降雨機率 ${d1W.rainProb}%，最大風速 ${d1W.wind} km/h。</div></li>`,
        `<li><span>🌬️</span><div><strong>【${escHtml(d2W.locName)} D02 戶外監測】</strong>氣溫 ${d2W.maxT}~${d2W.minT}°C，目前風速 ${d2W.wind} km/h（請留意戶外與跨城交通天候變化）。</div></li>`
    ];
    [...staticNews, ...liveNews].slice(0, 3).forEach(n => {
        const tHtml = n.link ? `<a href="${escHtml(n.link)}" target="_blank" rel="noopener" style="color:inherit;">${escHtml(n.title)} ↗</a>` : escHtml(n.title);
        quickList.push(`<li><span>🚨</span><div><strong>${tHtml}：</strong>${escHtml(n.desc)}</div></li>`);
    });
    $('info-quick-five').innerHTML = quickList.join('');

    $('info-radar-grid').innerHTML = dayCoords.map(item => {
        const w = liveWeatherByDay[item.dayCode] || { maxT: 26, minT: 20, rainProb: 20, wind: 10 };
        const isWarn = w.wind >= 20 || w.rainProb >= 60 || w.minT <= 0;
        const wcUrl = `https://weather.com/zh-TW/weather/today/l/${item.lat},${item.lng}`;
        const windyUrl = `https://www.windy.com/${item.lat}/${item.lng}?wind,${item.lat},${item.lng},11`;
        return `<div class="radar-cell ${isWarn ? 'warn' : ''}"><a href="${wcUrl}" target="_blank" rel="noopener" class="radar-main-link"><div class="radar-day-num">${item.dayCode}・${escHtml(item.locName)}</div><div class="radar-day-status">${isWarn ? '⚠️' : '☀️'} ${w.maxT}~${w.minT}°C｜風速 ${w.wind}km/h</div></a><div class="radar-ext-links"><a href="${wcUrl}" target="_blank" rel="noopener" class="radar-ext-a">🌤️ Weather</a><a href="${windyUrl}" target="_blank" rel="noopener" class="radar-ext-a">🌬️ Windy</a></div></div>`;
    }).join('');

    updateAndRenderCumulativeClippings(dayCoords, liveNews, winState);
    if (isManualClick) { refreshBtn.textContent = '✔ 已更新最新情報'; setTimeout(() => { refreshBtn.textContent = '↻ 重新整理'; }, 1800); }
}

function updateAndRenderCumulativeClippings(dayCoords, liveNews, winState) {
    const storageKey = `flaneur_clippings_archive_v5_${tripId}`;
    const staticNews = Array.isArray(rawItineraryData.urgentNews) ? rawItineraryData.urgentNews : [];
    let archive = [];

    if (winState.status === 'upcoming') {
        archive = [...staticNews];
    } else {
        try { archive = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch {}
        const existingIds = new Set(archive.map(i => i.id));
        const addUnique = (items, toFront = false) => items.forEach(it => {
            if (it?.id && !existingIds.has(it.id)) { toFront ? archive.unshift(it) : archive.push(it); existingIds.add(it.id); }
        });
        addUnique(staticNews, false);
        if (winState.status === 'active') {
            addUnique(liveNews || [], true);
            addUnique(dayCoords.map(item => {
                const w = liveWeatherByDay[item.dayCode]; if (!w) return null;
                const isSevere = w.wind >= 18 || w.rainProb >= 60 || w.minT <= 0;
                return {
                    id: `weather-${item.stdRegion}-${w.maxT}-${w.minT}`,
                    category: '天氣', region: item.stdRegion, urgent: isSevere, tag: `${item.dayCode} 即時氣象`,
                    title: `【${item.stdRegion}氣象速報】今日 ${w.maxT}~${w.minT}°C・降雨機率 ${w.rainProb}%・風速 ${w.wind} km/h`,
                    desc: isSevere ? '⚠️ 監測到較強陣風、高降雨機率或低溫，戶外與交通行程請留意變動。' : `目前 ${item.stdRegion} 氣候穩定，適合按原訂計畫漫遊。`
                };
            }).filter(Boolean), false);
            if (!isPreviewMode) try { localStorage.setItem(storageKey, JSON.stringify(archive.slice(0, 40))); } catch {}
        }
    }

    allInfoClippings = archive;
    const regions = new Set([...normalizedDays.map(d => d.region), ...archive.map(i => i.region)].filter(Boolean));
    $('clip-region-select').innerHTML = `<option value="ALL">全部地區</option>` + [...regions].map(r => `<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('');
    filterInfoClippings();
}

function filterInfoClippings() {
    const reg = $('clip-region-select').value;
    const kw = ($('clip-search-input').value || '').trim().toLowerCase();
    const filtered = allInfoClippings.filter(i =>
        (currentClipCategory === 'ALL' || i.category === currentClipCategory) &&
        (reg === 'ALL' || i.region === reg) &&
        (!kw || i.title.toLowerCase().includes(kw) || i.desc.toLowerCase().includes(kw))
    );
    $('info-clippings-list').innerHTML = filtered.length
        ? filtered.map(i => `
            <div class="clip-item ${i.urgent ? 'urgent' : ''}">
                <div class="clip-item-top">
                    <span>${i.urgent ? '<span class="clip-urgent-badge">🚨 緊急注意</span> ' : ''}📌 ${escHtml(i.category)} ｜ <strong>${escHtml(i.region)}</strong></span>
                    <span>${escHtml(i.tag || '')}</span>
                </div>
                <div class="clip-item-title">${i.link ? `<a href="${escHtml(i.link)}" target="_blank" rel="noopener">${escHtml(i.title)} ↗</a>` : escHtml(i.title)}</div>
                <div class="clip-item-desc">${escHtml(i.desc)}</div>
            </div>`).join('')
        : `<div style="text-align:center;padding:24px;color:#718096;font-size:0.88rem;">目前沒有符合篩選條件的快訊剪報</div>`;
}

/* === 9. 🎫 票券蒐集：住宿憑證、交通時刻、美食紀錄（靜態渲染） === */
const toggleAllTicketsInPanel = (panelId, expand) => $(panelId)?.querySelectorAll('.collapsible-ticket-card').forEach(c => c.classList.toggle('open', expand));

function renderPackStaticViews() {
    const transportTickets = [], rawHotels = [], transits = [], foods = [], autoExpenses = [];
    totalTripSpotCount = 0;

    (rawItineraryData.hotelVouchers || []).forEach((hv, idx) => {
        const name = (hv.hotelName || '').trim();
        rawHotels.push({
            key: name.split('(')[0].trim(), officialName: name,
            dayStart: hv.checkIn || `Day 0${idx + 1}`, dayEnd: hv.checkOut || '',
            nights: Number(hv.nights) || 1, bookingId: hv.bookingId || `HTL-0${idx + 1}`,
            roomType: hv.roomType || '標準雙人房', mealPlan: hv.mealPlan || '依訂單方案為準', address: hv.address || '',
            affHtml: buildAffiliateHTML(hv)
        });
    });

    normalizedDays.forEach(dayObj => (dayObj.chapters || []).forEach((ch, cIdx) => {
        totalTripSpotCount++;
        const meta = classifyChapterMeta(ch, cIdx, cIdx > 0 ? dayObj.chapters[cIdx - 1] : null);

        if (meta.stampChar === '驛' || /機場|Skyliner|新幹線|ETS|纜車|遊船|劇場|敘宴|狐狸村|動物園|鐵塔/i.test(meta.pureName)) {
            const isFlight = /機場/i.test(meta.pureName) && /航班|起飛|KHH|KUL|SIN|NRT|AirAsia/i.test(`${meta.pureName} ${meta.transitInfo?.seatType || ''}`);
            transportTickets.push({
                day: dayObj.day, type: isFlight ? 'flight' : (meta.stampChar === '驛' ? 'transit' : 'spot'),
                leftLabel: isFlight ? '飛' : (meta.stampChar === '驛' ? '座' : '券'),
                title: meta.transitInfo ? meta.transitInfo.routeText : meta.pureName,
                seatType: meta.transitInfo ? meta.transitInfo.seatType : meta.categoryLabel,
                alignedClock: meta.timeStr, timeRange: meta.transitInfo ? meta.transitInfo.timeRange : meta.timeStr,
                timetableUrl: meta.transitInfo?.timetableUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meta.pureName)}`,
                timetableLabel: meta.transitInfo?.timetableLabel || '查看時刻表與官網',
                note: meta.noteText,
                affHtml: buildAffiliateHTML(ch)
            });
        }

        if (meta.transitInfo && (meta.transitInfo.cost > 0 || meta.transitInfo.mode !== 'walk')) {
            transits.push({ day: dayObj.day, currency: ch.transitCurrency || currentCurrencyCode, ...meta.transitInfo });
            if (meta.transitInfo.cost > 0) autoExpenses.push({ category: '交通', day: dayObj.day, title: `車資｜${meta.transitInfo.routeText}`, amount: meta.transitInfo.cost, currency: ch.transitCurrency || currentCurrencyCode });
        }

        if (meta.isFoodSpot) {
            foods.push({
                day: dayObj.day, time: meta.timeStr, name: meta.pureName,
                review: meta.foodReview, isCustom: Boolean(ch.foodReview && !ch.foodReview.includes('【AI 美味預覽')),
                policy: meta.foodPolicy,
                affHtml: buildAffiliateHTML(ch)
            });
        }
    }));

    const srcBaseline = rawItineraryData.expenseItems?.length ? rawItineraryData.expenseItems : autoExpenses;
    baselineExpensesTWD = srcBaseline.map((i, idx) => {
        const itemCur = String(i.currency || currentCurrencyCode || 'TWD').toUpperCase();
        const origAmt = Number(i.amount) || 0;
        const rate = itemCur === 'TWD' ? 1 : (itemCur === currentCurrencyCode ? baselineToTwdRate : (FALLBACK_TWD_RATES[itemCur] || 1));
        const twdAmt = Math.round(origAmt * rate);
        return {
            id: `base_${idx}`, isBaseline: true,
            category: i.category || '交通', day: i.day || '', date: '',
            title: i.title || '', payMethod: '行程預估',
            currency: itemCur, originalAmount: origAmt,
            exchangeRate: rate, hasFee: false, twdAmount: twdAmt, note: ''
        };
    });

    const mergedHotels = [];
    rawHotels.forEach(e => {
        const last = mergedHotels.at(-1);
        if (last && last.key === e.key && (!last.dayEnd || last.dayEnd === e.dayStart)) {
            last.totalNights += e.nights; last.dayEnd = e.dayEnd;
            if (e.bookingId && !last.bookingIds.includes(e.bookingId)) last.bookingIds.push(e.bookingId);
            if (!last.affHtml && e.affHtml) last.affHtml = e.affHtml;
        } else mergedHotels.push({ ...e, totalNights: e.nights, bookingIds: [e.bookingId] });
    });

    // 快取給旅遊小冊產生器使用
    cachedMergedHotels = mergedHotels;
    cachedTransportTickets = transportTickets;
    cachedTransits = transits;

    const findHotelAffHtml = (hotelName) => {
        const cleanKey = (hotelName || '').split(/[（(〈]/)[0].replace(/飯店|酒店|旅館|溫泉|天然温泉|杜都の湯/g, '').trim();
        if (!cleanKey) return '';
        for (const d of normalizedDays) {
            for (const ch of (d.chapters || [])) {
                const hay = `${ch.title || ''} ${ch.spotName || ''}`;
                if (hay.includes(cleanKey) || (cleanKey.includes('御宿野乃') && hay.includes('御宿野乃')) || (cleanKey.includes('APA') && hay.includes('APA'))) {
                    const html = buildAffiliateHTML(ch);
                    if (html) return html;
                }
            }
        }
        return '';
    };

    // 1. 票券住宿
    $('pack-vouchers').innerHTML = `
        <div class="pack-toolbar">
            <span>💡 點擊展開完整憑證（連續住宿已自動合併）：</span>
            <div><button type="button" class="pack-toggle-all-btn" onclick="toggleAllTicketsInPanel('pack-vouchers',true)">全部展開</button> <button type="button" class="pack-toggle-all-btn" onclick="toggleAllTicketsInPanel('pack-vouchers',false)">全部收合</button></div>
        </div>
        <h4 style="margin:12px 0 8px;color:var(--accent-brown-dark);font-size:0.92rem;">🏨 連續住宿確認憑證（共 ${mergedHotels.length} 間）</h4>
        ${mergedHotels.map(h => `
            <div class="collapsible-ticket-card">
                <div class="ticket-summary-head" onclick="this.parentElement.classList.toggle('open')">
                    <div class="ticket-left-strip hotel"><span style="font-size:0.7rem;opacity:0.85;">${escHtml(h.dayStart)}</span><strong style="font-size:1rem;">宿</strong></div>
                    <div class="ticket-head-main">
                        <div><div class="ticket-head-title">🏨 ${escHtml(h.officialName)}</div><div class="ticket-head-sub">入住區間：${escHtml(h.dayStart)} ➔ ${escHtml(h.dayEnd)}</div></div>
                        <div class="ticket-head-right"><span class="ticket-time-pill reserved">🌙 ${h.totalNights} 晚</span><span class="ticket-arrow">▶</span></div>
                    </div>
                </div>
                <div class="ticket-detail-body">
                    <div class="hotel-voucher-paper">
                        <div class="hv-top-banner"><span>HOTEL CONFIRMATION VOUCHER</span><span class="hv-stamp-confirmed">✔ CONFIRMED</span></div>
                        <div class="hv-check-grid">
                            <div><div class="hv-check-label">CHECK-IN</div><div class="hv-check-val">${escHtml(h.dayStart)} · 15:00 後</div></div>
                            <div class="hv-nights-pill">共 ${h.totalNights} 晚</div>
                            <div><div class="hv-check-label">CHECK-OUT</div><div class="hv-check-val">${escHtml(h.dayEnd)} · 11:00 前</div></div>
                        </div>
                        <table class="hv-info-table">
                            <tr><th>飯店名稱</th><td><strong>${escHtml(h.officialName)}</strong></td></tr>
                            <tr><th>訂單編號</th><td>${escHtml(h.bookingIds.join(' / '))}</td></tr>
                            <tr><th>預訂房型</th><td>${escHtml(h.roomType)}</td></tr>
                            <tr><th>專案設施</th><td>${escHtml(h.mealPlan)}</td></tr>
                            <tr><th>地址交通</th><td>${escHtml(h.address)}</td></tr>
                        </table>
                        <div class="hv-barcode-bar">
                            <div class="css-barcode"></div>
                            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.officialName)}" target="_blank" rel="noopener" class="timetable-link-btn">🗺️ 開啟飯店地圖 ↗</a>
                        </div>
                    </div>
                    ${h.affHtml || findHotelAffHtml(h.officialName)}
                </div>
            </div>`).join('')}
        <h4 style="margin:20px 0 8px;color:var(--accent-brown-dark);font-size:0.92rem;">✈️ 航班・列車・重要票券（共 ${transportTickets.length} 項）</h4>
        ${transportTickets.map(t => `
            <div class="collapsible-ticket-card">
                <div class="ticket-summary-head" onclick="this.parentElement.classList.toggle('open')">
                    <div class="ticket-left-strip ${t.type}"><span style="font-size:0.7rem;opacity:0.85;">${escHtml(t.day)}</span><strong style="font-size:1rem;">${t.leftLabel}</strong></div>
                    <div class="ticket-head-main">
                        <div><div class="ticket-head-title">${escHtml(t.title)}</div><div class="ticket-head-sub">${escHtml(t.seatType)}</div></div>
                        <div class="ticket-head-right"><span class="ticket-time-pill">${escHtml(t.alignedClock)}</span><span class="ticket-arrow">▶</span></div>
                    </div>
                </div>
                <div class="ticket-detail-body">
                    <div style="font-size:0.86rem;line-height:1.65;margin-bottom:10px;">
                        <div><strong>🕒 班次時刻：</strong>${escHtml(t.timeRange)}</div>
                        <div><strong>💺 席次票種：</strong>${escHtml(t.seatType)}</div>
                        ${t.note ? `<div style="margin-top:6px;padding:8px 12px;background:#FFF9F2;border-left:3px solid #D97724;border-radius:6px;white-space:pre-line;"><strong>⚠️ 注意事項：</strong>\n${escHtml(t.note)}</div>` : ''}
                    </div>
                    <div style="display:flex;justify-content:flex-end;"><a href="${t.timetableUrl}" target="_blank" rel="noopener" class="timetable-link-btn">🕒 ${escHtml(t.timetableLabel)} ↗</a></div>
                    ${t.affHtml || ''}
                </div>
            </div>`).join('')}`;

    // 2. 交通時刻
    $('pack-transit').innerHTML = `
        <div class="pack-toolbar">
            <span>起始站 → 轉乘 → 目的站（點擊展開時刻表）：</span>
            <div><button type="button" class="pack-toggle-all-btn" onclick="toggleAllTicketsInPanel('pack-transit',true)">全部展開</button> <button type="button" class="pack-toggle-all-btn" onclick="toggleAllTicketsInPanel('pack-transit',false)">全部收合</button></div>
        </div>
        ${transits.map(t => `
            <div class="collapsible-ticket-card">
                <div class="ticket-summary-head" onclick="this.parentElement.classList.toggle('open')">
                    <div class="ticket-left-strip transit"><span style="font-size:0.7rem;">${escHtml(t.day)}</span><strong style="font-size:1.1rem;">${t.icon}</strong></div>
                    <div class="ticket-head-main">
                        <div><div class="ticket-head-title">${escHtml(t.routeText)}</div><div class="ticket-head-sub">${escHtml(t.modeName)} ・ ${escHtml(t.seatType)}</div></div>
                        <div class="ticket-head-right"><span class="ticket-time-pill">${escHtml(t.alignedClock)}（約 ${t.mins}分）</span><span class="ticket-arrow">▶</span></div>
                    </div>
                </div>
                <div class="ticket-detail-body">
                    <div style="font-size:0.86rem;line-height:1.65;margin-bottom:10px;">
                        <div><strong>📍 動線：</strong>${escHtml(t.routeText)}</div>
                        <div><strong>🕒 時刻：</strong>${escHtml(t.timeRange)}</div>
                        <div><strong>💰 預估車資：</strong>NT$${toTwd(t.cost, t.currency).toLocaleString()}</div>
                    </div>
                    <div style="display:flex;justify-content:flex-end;"><a href="${t.timetableUrl}" target="_blank" rel="noopener" class="timetable-link-btn">🕒 ${escHtml(t.timetableLabel)} ↗</a></div>
                </div>
            </div>`).join('')}`;

    // 3. 美食紀錄
    $('pack-food').innerHTML = `
        <div class="pack-toolbar">
            <span>旅途美食清單（共 ${foods.length} 家）：</span>
            <div><button type="button" class="pack-toggle-all-btn" onclick="toggleAllTicketsInPanel('pack-food',true)">全部展開</button> <button type="button" class="pack-toggle-all-btn" onclick="toggleAllTicketsInPanel('pack-food',false)">全部收合</button></div>
        </div>
        ${foods.map((f, i) => `
            <div class="collapsible-ticket-card ${i < 2 ? 'open' : ''}">
                <div class="ticket-summary-head" onclick="this.parentElement.classList.toggle('open')">
                    <div class="ticket-left-strip spot"><span style="font-size:0.7rem;">${escHtml(f.day)}</span><strong style="font-size:0.95rem;">#${i + 1}</strong></div>
                    <div class="ticket-head-main">
                        <div><div class="ticket-head-title">🍱 ${escHtml(f.name)}</div><div class="ticket-head-sub">預計時段：${escHtml(f.time)}</div></div>
                        <div class="ticket-head-right"><span class="ticket-time-pill">${f.isCustom ? '✨ 實測更新' : '🤖 AI 預覽'}</span><span class="ticket-arrow">▶</span></div>
                    </div>
                </div>
                <div class="ticket-detail-body">
                    <div class="food-review-box"><div style="font-weight:700;margin-bottom:4px;color:#1E40AF;">📘 美味紀錄</div><div style="white-space:pre-line;">${escHtml(f.review)}</div></div>
                    <div class="food-policy-box"><div style="font-weight:700;margin-bottom:4px;color:#22543D;">⚠️ 用餐 / 預約注意</div><div style="white-space:pre-line;">${escHtml(f.policy)}</div></div>
                    ${f.affHtml || ''}
                </div>
            </div>`).join('')}`;

    if (typeof renderBudgetPanel === 'function') renderBudgetPanel();
    if (typeof renderChecklistPanel === 'function') renderChecklistPanel();
    if (typeof renderNotesPanel === 'function') renderNotesPanel();
}
