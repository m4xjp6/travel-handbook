/* =====================================================================
   °•* Flâneur *•° 共用數位景點印章引擎（assets/stamp-engine.js）
   風格融合：JR TRAIN TRIP 經典幾何章 × EKITAG 數位車站章 × 莫蘭迪復古印泥
   適用頁面：journal.html（收集預覽＆防呆建議）與 passport.html（印章牆渲染）
   ===================================================================== */

(function (global) {
    'use strict';

    let _svgUid = 0;

    /* === 1. 外框、圖樣與復古印泥色定義 === */
    const STAMP_SHAPES = [
        { key: 'circle',  label: '圓形雙層' },
        { key: 'ticket',  label: '硬券車票' },
        { key: 'octagon', label: '八角印' },
        { key: 'hexagon', label: '六角印' },
        { key: 'square',  label: '圓角方印' },
        { key: 'wave',    label: '多層波浪' },
        { key: 'shrine',    label: '日式神社' }
    ];

    const STAMP_MOTIFS = [
        { key: 'snow_ice', label: '❄️ 雪景 / 冰雪景觀' },
        { key: 'train',    label: '🚄 車站 / 鐵道交通' },
        { key: 'flight',   label: '✈️ 機場 / 航空通關' },
        { key: 'torii',    label: '⛩️ 神社 / 神道信仰' },
        { key: 'mountain', label: '🏔️ 山岳 / 展望絕景' },
        { key: 'boat',     label: '⛴️ 港灣 / 遊船海景' },
        { key: 'food',     label: '🍜 美食 / 在地美饌' },
        { key: 'onsen',    label: '♨️ 溫泉 / 湯屋名湯' },
        { key: 'tower',    label: '🗼 地標 / 城市塔樓' },
        { key: 'animal',   label: '🦊 生態 / 動物景點' },
        { key: 'hotel',    label: '🏨 旅宿 / 飯店入住' },
        { key: 'shopping', label: '🏮 老街散策' },
        { key: 'landmark', label: '🧭 經典 / 綜合印記' }
    ];

    const STAMP_COLORS = [
        { key: '#354F6B', label: '車站藏青' },
        { key: '#A84438', label: '神社朱砂' },
        { key: '#3B6B52', label: '絕景松葉' },
        { key: '#8E5B3E', label: '美食焦茶' },
        { key: '#346E8C', label: '港灣海藍' },
        { key: '#73527A', label: '溫泉梅紫' },
        { key: '#6E5A4F', label: '手帳暖棕' },
        { key: '#B27C35', label: '秋陽琥珀' }
    ];

    const COUNTRY_EN_MAP = {
        '日本': 'JAPAN',
        '台灣': 'TAIWAN',
        '臺灣': 'TAIWAN',
        '馬來西亞': 'MALAYSIA',
        '新加坡': 'SINGAPORE',
        '韓國': 'KOREA',
        '香港': 'HONG KONG',
        '澳門': 'MACAU',
        '泰國': 'THAILAND',
        '越南': 'VIETNAM',
        '法國': 'FRANCE',
        '英國': 'UK',
        '義大利': 'ITALY',
        '德國': 'GERMANY',
        '美國': 'USA',
        '澳洲': 'AUSTRALIA'
    };

    // 常見國際機場代碼對照（輔助相似印章防呆比對）
    const AIRPORT_CODE_RE = /\b(KHH|TPE|TSA|RMQ|NRT|HND|KIX|CTS|SDJ|FUK|OKA|ICN|GMP|HKG|KUL|SIN|PEN|BKK|DMK)\b/i;

    /* === 2. 基礎小工具 === */
    function escSvg(str) {
        return String(str || '').replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }

    function hashString(str) {
        let h = 2166136261;
        const s = String(str || '');
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    function formatStampDate(dateStr) {
        const s = String(dateStr || '').trim();
        if (!s) return 'FLÂNEUR STAMP';
        return s.replace(/-/g, '.');
    }

    function normalizeStampImagePath(raw) {
        const s = String(raw || '').trim().replace(/^\/+/, '');
        if (!s) return '';
        if (/^https?:\/\//i.test(s) || s.includes('/')) return s;
        return `media/stamps/${s}`;
    }

    function calcTripDayDate(startDate, dayStr) {
        if (!startDate) return '';
        const base = new Date(`${startDate}T00:00:00`);
        if (isNaN(base)) return '';
        const m = String(dayStr || '').match(/(\d+)/);
        const offset = m ? Math.max(0, parseInt(m[1], 10) - 1) : 0;
        const target = new Date(base.getTime() + offset * 86400000);
        const y = target.getFullYear();
        const mo = String(target.getMonth() + 1).padStart(2, '0');
        const d = String(target.getDate()).padStart(2, '0');
        return `${y}-${mo}-${d}`;
    }

    /* === 3. 依站點與分類自動推斷外框、圖樣與復古印泥色 === */
    function inferCountryFromContext(countryHint, regionHint, tripIdHint, timezoneHint) {
        const direct = String(countryHint || '').trim();
        if (direct) return direct;
        const hay = `${regionHint || ''} ${tripIdHint || ''}`;
        if (/新加坡|樟宜|魚尾獅|聖淘沙|牛車水|Singapore|SIN\b/i.test(hay)) return '新加坡';
        if (/馬來西亞|吉隆坡|怡保|馬六甲|檳城|新山|Malaysia|KUL\b/i.test(hay)) return '馬來西亞';
        if (/高雄|台北|臺北|台中|臺中|台南|臺南|宜蘭|花蓮|台灣|臺灣|KHH\b|TPE\b|RMQ\b/i.test(hay)) return '台灣';
        if (/首爾|釜山|韓國|ICN\b/i.test(hay)) return '韓國';
        if (/香港|HKG\b/i.test(hay)) return '香港';
        if (/日本|東京|山形|仙台|藏王|銀山|松島|上野|成田|關西|大阪|京都|tohoku|NRT\b|KIX\b/i.test(hay)) return '日本';
        if (timezoneHint === 'Asia/Tokyo') return '日本';
        if (timezoneHint === 'Asia/Kuala_Lumpur') return '馬來西亞';
        if (timezoneHint === 'Asia/Singapore') return '新加坡';
        if (timezoneHint === 'Asia/Taipei') return '台灣';
        return '日本';
    }

    function inferStampPreset(meta = {}) {
        const name = String(meta.name || meta.spotName || meta.title || '').trim();
        const cat = String(meta.categoryLabel || '').trim();
        const region = String(meta.region || '').trim();
        const country = inferCountryFromContext(meta.country, `${name} ${region}`, meta.tripId, meta.timezone);
        const hay = `${name} ${cat}`;

        let shape = 'circle';
        let motif = 'landmark';
        let color = '#6E5A4F';

        if (/機場|航空站|航廈|航班|起飛|降落|AirAsia|KHH|TPE|NRT|HND|KIX|KUL|SIN|ICN|HKG/i.test(hay)) {
            shape = 'ticket'; motif = 'flight'; color = '#354F6B';
        } else if (/遊船|觀光船|渡輪|港口|鹽釜港|松島海岸|海灣|碼頭/i.test(hay)) {
            shape = 'wave'; motif = 'boat'; color = '#346E8C';
        } else if (/新幹線|Skyliner|ETS|KTM|JR|電鐵|地鐵|捷運|車站|轉乘|火車|巴士|纜車/i.test(hay) || cat.includes('交通')) {
            shape = /纜車/.test(hay) ? 'hexagon' : 'ticket';
            motif = /纜車/.test(hay) ? 'mountain' : 'train';
            color = '#354F6B';
        } else if (/神社|寺|廟|宮|鳥居|城跡|城堡|古城|遺跡|大佛|教堂|清真寺/i.test(hay)) {
            shape = 'octagon'; motif = 'torii'; color = '#A84438';
        } else if (/溫泉|湯|澡堂|銀山|藏王溫泉/i.test(hay)) {
            shape = 'wave'; motif = 'onsen'; color = '#73527A';
        } else if (/狐狸|動物園|水族館|牧場|生態|鳥園|貓|熊/i.test(hay)) {
            shape = 'circle'; motif = 'animal'; color = '#3B6B52';
        } else if (/鐵塔|雙峰塔|晴空塔|展望台|摩天輪|塔|星耀樟宜|Tower|Sky/i.test(hay)) {
            shape = 'hexagon'; motif = 'tower'; color = '#3B6B52';
        } else if (/樹冰|雪|山|峰|峽|瀑布|湖|夕陽|階梯|公園|展望|森林|花園/i.test(hay)) {
            shape = 'hexagon'; motif = 'mountain'; color = '#3B6B52';
        } else if (meta.isFood || cat.includes('美饌') || /餐廳|料理|拉麵|牛舌|牛たん|燒肉|烤鴨|咖啡|茶室|茶餐室|肉骨茶|雞飯|娘惹|甜點|屋台|美食|Cafe|Coffee/i.test(hay)) {
            shape = 'square'; motif = 'food'; color = '#8E5B3E';
        } else if (cat.includes('住宿') || /飯店|酒店|旅館|溫泉旅|御宿野乃|Hotel|Méridien|Aloft|Holiday Inn|Village|APA/i.test(hay)) {
            shape = 'square'; motif = 'hotel'; color = '#6E5A4F';
        } else if (/商店街|老街|市場|夜市|郵局|郵便局|雜貨|百貨|阿美橫丁|谷中銀座|雞場街|茨廠街/i.test(hay)) {
            shape = /郵局|郵便局/.test(hay) ? 'wave' : 'square';
            motif = 'shopping';
            color = '#B27C35';
        }

        return {
            name: cleanPrimarySpotName(name),
            country,
            region: region.replace(/地區/g, '').trim(),
            shape,
            motif,
            color
        };
    }

    /* === 4. 智慧名稱拆解與相似舊章防呆比對 === */
    function cleanPrimarySpotName(raw) {
        return String(raw || '')
            .replace(/^\d+\.\s*/, '')
            .replace(/^[^｜|]+[｜|]\s*/, '')
            .replace(/\s*\bcheck-?(in|out)\b\s*/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeForCompare(str) {
        return String(str || '')
            .toLowerCase()
            .replace(/\bcheck-?(in|out)\b/gi, '')
            .replace(/[（）()〈〉《》「」【】\[\]・·\-—–_→➔＆&\s]/g, '');
    }

    // 從複合站名自動拆出乾淨的候選印章名稱
    function suggestStampNames(rawSpotName) {
        const cleaned = cleanPrimarySpotName(rawSpotName);
        if (!cleaned) return [];

        const candidates = [];
        const add = v => {
            const s = cleanPrimarySpotName(v).replace(/^[（(]|[）)]$/g, '').trim();
            if (s && s.length >= 2 && !/^(機場|車站|轉乘|出發|抵達|移動)$/.test(s) && !candidates.includes(s)) {
                candidates.push(s);
            }
        };

        // 檢查「外層名稱（A → B）」結構
        const arrowBracket = cleaned.match(/^([^（(]+?)\s*[（(]([^）)]+?[→➔][^）)]+?)[）)]$/);
        if (arrowBracket) {
            const outer = arrowBracket[1].trim();
            const innerParts = arrowBracket[2].split(/[→➔]/).map(s => s.trim());
            add(outer);
            innerParts.forEach(add);
        }

        // 檢查括號外的「A ＆ B」雙景點結構
        const outerSplitAmp = splitOutsideBrackets(cleaned, /[＆&]/);
        if (outerSplitAmp.length > 1) {
            outerSplitAmp.forEach(part => {
                add(part);
                const stripped = part.replace(/[（(〈《][^）)〉》]*[）)〉》]/g, '').trim();
                add(stripped);
            });
        }

        // 去除括號備註的簡潔版（例如：上野阿美橫丁商店街）
        const noParens = cleaned.replace(/[（(][^）)]*[）)]/g, '').trim();
        add(noParens);
        add(cleaned);

        return candidates.slice(0, 5);
    }

    function splitOutsideBrackets(str, delimRegex) {
        const res = [];
        let depth = 0, buf = '';
        for (const ch of String(str || '')) {
            if ('（(〈《「【['.includes(ch)) depth++;
            else if ('）)〉》」】]'.includes(ch)) depth = Math.max(0, depth - 1);
            if (depth === 0 && delimRegex.test(ch)) {
                if (buf.trim()) res.push(buf.trim());
                buf = '';
            } else {
                buf += ch;
            }
        }
        if (buf.trim()) res.push(buf.trim());
        return res;
    }

    // 比對護照既有印章，找出同名或高度相似的印章名稱以防重複建章
    function findSimilarExistingStamps(inputName, existingStamps) {
        const raw = String(inputName || '').trim();
        if (!raw || !Array.isArray(existingStamps) || !existingStamps.length) return [];

        const normInput = normalizeForCompare(raw);
        if (normInput.length < 2) return [];
        const inputAirport = (raw.match(AIRPORT_CODE_RE) || [])[1]?.toUpperCase() || '';

        // 依既有印章名稱去重並統計次數
        const byName = new Map();
        existingStamps.forEach(st => {
            const n = String(st.name || '').trim();
            if (!n) return;
            const key = n.toLowerCase();
            if (!byName.has(key)) {
                byName.set(key, { name: n, country: st.country || '', region: st.region || '', shape: st.shape, motif: st.motif, color: st.color, customImage: st.customImage || '', dates: new Set() });
            }
            if (st.date) byName.get(key).dates.add(st.date);
        });

        const scored = [];
        byName.forEach(item => {
            const normEx = normalizeForCompare(item.name);
            if (!normEx) return;

            let score = 0;
            const exAirport = (item.name.match(AIRPORT_CODE_RE) || [])[1]?.toUpperCase() || '';

            if (normEx === normInput) {
                score = 100;
            } else if (inputAirport && exAirport && inputAirport === exAirport) {
                score = 92;
            } else if (normInput.length >= 2 && (normEx.includes(normInput) || normInput.includes(normEx))) {
                score = 80;
            } else {
                // Bigram 相似度檢查（捕捉「仙台車站」vs「JR 仙台站」）
                const biA = getBigrams(normInput);
                const biB = getBigrams(normEx);
                if (biA.size && biB.size) {
                    let hit = 0;
                    biA.forEach(b => { if (biB.has(b)) hit++; });
                    const dice = (2 * hit) / (biA.size + biB.size);
                    if (dice >= 0.45) score = Math.round(dice * 75);
                }
            }

            if (score >= 34) {
                scored.push({
                    ...item,
                    visitCount: Math.max(1, item.dates.size),
                    exact: score === 100,
                    score
                });
            }
        });

        return scored.sort((a, b) => b.score - a.score).slice(0, 4);
    }

    function getBigrams(str) {
        const set = new Set();
        for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
        return set;
    }

    /* === 5. 12 款精細單色線條向量插畫（48×48 畫布） === */
    function getMotifSvgPath(motif) {
        switch (motif) {
            case 'train': // JR 新幹線／鐵道車頭
                return `
                    <rect x="11" y="7" width="26" height="27" rx="8" fill="none" stroke="currentColor" stroke-width="2.1"/>
                    <path d="M15 17 H33 M15 11 H33" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                    <rect x="15" y="13" width="18" height="7" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/>
                    <circle cx="17" cy="27" r="2" fill="currentColor"/>
                    <circle cx="31" cy="27" r="2" fill="currentColor"/>
                    <path d="M16 34 L11 42 M32 34 L37 42 M13 39 H35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
            case 'flight': // 機場航班
                return `
                    <path d="M24 6 L27 19 L40 24 L40 27 L27 25 L26 35 L32 38 L32 41 L24 39 L16 41 L16 38 L22 35 L21 25 L8 27 L8 24 L21 19 Z"
                          fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    <path d="M9 12 Q13 10 17 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>`;
            case 'torii': // 日本神社鳥居
                return `
                    <path d="M7 12 Q24 16 41 12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
                    <path d="M10 17 H38" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M11 23 H37" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M16 17 V41 M32 17 V41 M24 17 V23" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                    <path d="M13 41 H19 M29 41 H35" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`;
            case 'mountain': // 雪山／藏王樹冰絕景
                return `
                    <path d="M5 38 L19 14 L30 31 L35 23 L43 38 Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>
                    <path d="M14.5 21.5 L18 24 L20.5 21.5 L23.5 23.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="34" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/>`;
            case 'boat': // 觀光遊船與港灣波浪
                return `
                    <path d="M14 23 V16 H30 L34 23" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
                    <path d="M19 16 V11 H24 V16" fill="none" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M8 23 H40 L36 33 H12 Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>
                    <circle cx="19" cy="28" r="1.4" fill="currentColor"/><circle cx="25" cy="28" r="1.4" fill="currentColor"/>
                    <path d="M6 38 Q12 34 18 38 T30 38 T42 38" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`;
            case 'food': // 美饌料理碗與熱氣
                return `
                    <path d="M17 17 C15 13 19 12 17 8 M24 16 C22 12 26 11 24 7 M31 17 C29 13 33 12 31 8"
                          fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M9 22 H39 C39 32 33 37 24 37 C15 37 9 32 9 22 Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>
                    <path d="M17 37 V40 H31 V37" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    <path d="M27 22 L40 13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`;
            case 'onsen': // 經典溫泉湯煙記號
                return `
                    <path d="M16 25 C13 20 19 16 16 10 M24 23 C21 17 27 13 24 7 M32 25 C29 20 35 16 32 10"
                          fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
                    <path d="M11 29 C7 31 8 38 24 38 C40 38 41 31 37 29" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`;
            case 'tower': // 城市地標高塔
                return `
                    <path d="M24 6 V12 M21 12 H27 L31 30 L37 41 H29 C28 36 20 36 19 41 H11 L17 30 Z"
                          fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    <path d="M16 24 H32 M18 31 H30 M19 19 L29 24 M29 19 L19 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`;
            case 'animal': // 狐狸／動物生態
                return `
                    <path d="M11 11 L19 17 H29 L37 11 L39 25 L24 39 L9 25 Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>
                    <path d="M15 24 L19 25 M33 24 L29 25" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <circle cx="24" cy="34" r="2.2" fill="currentColor"/>
                    <path d="M14 14 L16 19 M34 14 L32 19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`;
            case 'hotel': // 旅宿飯店
                return `
                    <path d="M10 40 V14 L24 7 L38 14 V40 M7 40 H41" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
                    <rect x="16" y="18" width="4" height="4" fill="currentColor"/><rect x="28" y="18" width="4" height="4" fill="currentColor"/>
                    <rect x="16" y="25" width="4" height="4" fill="currentColor"/><rect x="28" y="25" width="4" height="4" fill="currentColor"/>
                    <path d="M21 40 V33 A3 3 0 0 1 27 33 V40" fill="none" stroke="currentColor" stroke-width="1.8"/>`;
            case 'shopping': // 老街暖簾／散策
                return `
                    <path d="M9 14 H39 V25 H9 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    <path d="M19 14 V25 M29 14 V25 M12 25 V39 H36 V25 M7 39 H41" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
                    <path d="M19 39 V31 H29 V39" fill="none" stroke="currentColor" stroke-width="1.7"/>
                    <path d="M14 10 H34" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`;
            default: // landmark：復古旅人羅盤星標
                return `
                    <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2.5"/>
                    <path d="M24 9 L27.5 20.5 L39 24 L27.5 27.5 L24 39 L20.5 27.5 L9 24 L20.5 20.5 Z"
                          fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
                    <circle cx="24" cy="24" r="2.3" fill="currentColor"/>`;
        }
    }

    /* === 6. 多變外框繪製（圓環、波浪、八角、六角、圓角方印、硬券車票） === */
    function buildWavyCirclePath(cx, cy, r, waves, amp) {
        const steps = waves * 8;
        let d = '';
        for (let i = 0; i <= steps; i++) {
            const ang = (i / steps) * Math.PI * 2;
            const rad = r + Math.sin(ang * waves) * amp;
            const x = (cx + Math.cos(ang) * rad).toFixed(2);
            const y = (cy + Math.sin(ang) * rad).toFixed(2);
            d += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
        }
        return d + ' Z';
    }

    function buildRegularPolyPoints(cx, cy, r, sides, rotDeg) {
        const pts = [];
        for (let i = 0; i < sides; i++) {
            const ang = ((i * 360 / sides) + rotDeg) * Math.PI / 180;
            pts.push(`${(cx + Math.cos(ang) * r).toFixed(1)},${(cy + Math.sin(ang) * r).toFixed(1)}`);
        }
        return pts.join(' ');
    }

    function buildShapeFrameSvg(shape) {
        switch (shape) {
            case 'wave':
                return `
                    <path d="${buildWavyCirclePath(100, 100, 91, 24, 3.2)}" fill="none" stroke="currentColor" stroke-width="2.6"/>
                    <circle cx="100" cy="100" r="82" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 2.5"/>`;
            case 'octagon':
                return `
                    <polygon points="${buildRegularPolyPoints(100, 100, 93, 8, 22.5)}" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round"/>
                    <polygon points="${buildRegularPolyPoints(100, 100, 85, 8, 22.5)}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 2.5" stroke-linejoin="round"/>`;
            case 'hexagon':
                return `
                    <polygon points="${buildRegularPolyPoints(100, 100, 94, 6, -90)}" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round"/>
                    <polygon points="${buildRegularPolyPoints(100, 100, 86, 6, -90)}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 2.5" stroke-linejoin="round"/>`;
            case 'square':
                return `
                    <rect x="14" y="14" width="172" height="172" rx="18" fill="none" stroke="currentColor" stroke-width="2.8"/>
                    <rect x="21" y="21" width="158" height="158" rx="13" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3"/>`;
            case 'ticket':
                return `
                    <path d="M 22 24 H 178 A 10 10 0 0 1 188 34 V 87 A 13 13 0 0 0 188 113 V 166 A 10 10 0 0 1 178 176 H 22 A 10 10 0 0 1 12 166 V 113 A 13 13 0 0 0 12 87 V 34 A 10 10 0 0 1 22 24 Z"
                          fill="none" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round"/>
                    <rect x="24" y="31" width="152" height="138" rx="6" fill="none" stroke="currentColor" stroke-width="1.15" stroke-dasharray="4 3"/>`;
            default: // circle（雙圓環）
                return `
                    <circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" stroke-width="3"/>
                    <circle cx="100" cy="100" r="85" fill="none" stroke="currentColor" stroke-width="1.2"/>
                    <circle cx="24" cy="100" r="2.1" fill="currentColor" opacity="0.75"/>
                    <circle cx="176" cy="100" r="2.1" fill="currentColor" opacity="0.75"/>`;
        }
    }

    /* === 7. 站點名稱智慧斷行（避免超出印章外框） === */
    function splitStampTitleLines(title, maxCharsPerLine = 7) {
        const clean = String(title || '旅途印記').trim();
        if (clean.length <= maxCharsPerLine) return [clean];

        // 優先在空白、中點、括號處斷行
        const tokens = clean.split(/(\s+|・|·|\/)/).filter(Boolean);
        if (tokens.length > 1) {
            const lines = [];
            let cur = '';
            tokens.forEach(tk => {
                const t = tk.trim();
                if (!t) return;
                if ((cur + t).length <= maxCharsPerLine + 1) cur += (cur && /^[a-z0-9]/i.test(t) ? ' ' : '') + t;
                else {
                    if (cur) lines.push(cur);
                    cur = t;
                }
            });
            if (cur) lines.push(cur);
            if (lines.length <= 3 && lines.every(l => l.length <= maxCharsPerLine + 2)) return lines;
        }

        const total = clean.length;
        if (total <= maxCharsPerLine * 2) {
            const mid = Math.ceil(total / 2);
            return [clean.slice(0, mid), clean.slice(mid)];
        }
        const chunk = Math.ceil(total / 3);
        const l1 = clean.slice(0, chunk);
        const l2 = clean.slice(chunk, chunk * 2);
        const l3 = clean.slice(chunk * 2);
        return [l1, l2, l3.length > maxCharsPerLine + 1 ? l3.slice(0, maxCharsPerLine) + '…' : l3];
    }

    /* === 8. 產生 TRAIN TRIP × EKITAG 風格純 SVG 印章 === */
    function buildStampSvg(stamp = {}, options = {}) {
        const uid = ++_svgUid;
        const name = String(stamp.name || '景點印章').trim();
        const country = String(stamp.country || '').trim();
        const region = String(stamp.region || '').trim();
        const shape = STAMP_SHAPES.some(s => s.key === stamp.shape) ? stamp.shape : 'circle';
        const motif = STAMP_MOTIFS.some(m => m.key === stamp.motif) ? stamp.motif : 'landmark';
        const color = stamp.color || '#354F6B';
        const dateLabel = formatStampDate(stamp.date);

        const countryEn = COUNTRY_EN_MAP[country] || (country ? country.toUpperCase() : 'TRAVEL');
        const regionShort = region.replace(/地區/g, '').split(/[・｜|]/)[0].trim();
        const topLabel = regionShort && regionShort !== country
            ? `${countryEn} ・ ${regionShort}`
            : countryEn;

        const isCurved = (shape === 'circle' || shape === 'wave');
        const maxPerLine = (shape === 'hexagon') ? 6 : 7;
        const lines = splitStampTitleLines(name, maxPerLine);
        const maxLineLen = Math.max(...lines.map(l => l.length));

        let titleFontSize = 15.5;
        if (lines.length === 1) titleFontSize = maxLineLen >= 7 ? 14 : 16.5;
        else if (lines.length === 2) titleFontSize = maxLineLen >= 8 ? 12.5 : 14;
        else titleFontSize = 11.8;

        const lineHeight = titleFontSize + 3.5;
        const startY = lines.length === 1 ? 124 : (lines.length === 2 ? 116 : 110);
        const titleTspans = lines.map((line, i) =>
            `<tspan x="100" y="${(startY + i * lineHeight).toFixed(1)}">${escSvg(line)}</tspan>`
        ).join('');

        // 微妙傾角（依名稱雜湊決定固定角度，預覽模式可關閉）
        const angle = options.noTilt ? 0 : (((hashString(name) % 70) - 35) / 10); // -3.5° ~ +3.5°

        let headerFooterSvg = '';
        let defsSvg = '';
        if (isCurved) {
            const topR = shape === 'wave' ? 68 : 71;
            const botR = shape === 'wave' ? 70 : 73;
            defsSvg = `
                <defs>
                    <path id="st-top-${uid}" d="M ${100 - topR},100 A ${topR},${topR} 0 0,1 ${100 + topR},100"/>
                    <path id="st-bot-${uid}" d="M ${100 - botR},100 A ${botR},${botR} 0 0,0 ${100 + botR},100"/>
                </defs>`;
            headerFooterSvg = `
                <text font-size="9.5" font-weight="700" letter-spacing="1.6" fill="currentColor" opacity="0.88" dominant-baseline="central">
                    <textPath href="#st-top-${uid}" xlink:href="#st-top-${uid}" startOffset="50%" text-anchor="middle">${escSvg(topLabel)}</textPath>
                </text>
                <text font-size="9.2" font-weight="700" letter-spacing="1.8" fill="currentColor" opacity="0.82" dominant-baseline="central">
                    <textPath href="#st-bot-${uid}" xlink:href="#st-bot-${uid}" startOffset="50%" text-anchor="middle">${escSvg(dateLabel)}</textPath>
                </text>`;
        } else {
            const topY = shape === 'hexagon' ? 47 : (shape === 'ticket' ? 47 : 41);
            const botY = shape === 'hexagon' ? 160 : (shape === 'ticket' ? 158 : 165);
            const dividerW = shape === 'hexagon' ? 36 : 48;
            headerFooterSvg = `
                <text x="100" y="${topY}" text-anchor="middle" font-size="9.2" font-weight="700" letter-spacing="1.4" fill="currentColor" opacity="0.86">${escSvg(topLabel)}</text>
                <line x1="${100 - dividerW}" y1="${botY - 13}" x2="${100 + dividerW}" y2="${botY - 13}" stroke="currentColor" stroke-width="0.9" stroke-dasharray="2.5 2.5" opacity="0.55"/>
                <text x="100" y="${botY}" text-anchor="middle" font-size="9.2" font-weight="700" letter-spacing="1.5" fill="currentColor" opacity="0.82">${escSvg(dateLabel)}</text>`;
        }

        const motifTranslateY = isCurved ? 52 : (shape === 'hexagon' ? 54 : 50);

        return `
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
                 class="flaneur-stamp-svg" style="color:${escSvg(color)};transform:rotate(${angle.toFixed(1)}deg);" role="img" aria-label="${escSvg(name)}">
                ${defsSvg}
                <g opacity="0.93">
                    ${buildShapeFrameSvg(shape)}
                    ${headerFooterSvg}
                    <g transform="translate(79, ${motifTranslateY}) scale(0.875)">
                        ${getMotifSvgPath(motif)}
                    </g>
                    <text text-anchor="middle" font-family="'Noto Serif TC', 'Noto Sans TC', serif" font-weight="700" font-size="${titleFontSize}" fill="currentColor">
                        ${titleTspans}
                    </text>
                </g>
            </svg>`;
    }

    /* === 9. 統一渲染入口（支援自訂圖片＋失敗自動退回 SVG 不破圖） === */
    function renderStampVisualHTML(stamp = {}, options = {}) {
        const svgHtml = buildStampSvg(stamp, options);
        const imgPath = normalizeStampImagePath(stamp.customImage);
        if (!imgPath) {
            return `<div class="stamp-visual-box">${svgHtml}</div>`;
        }
        const angle = options.noTilt ? 0 : (((hashString(stamp.name || '') % 70) - 35) / 10);
        return `
            <div class="stamp-visual-box">
                <img src="${escSvg(imgPath)}" alt="${escSvg(stamp.name || '自訂印章')}"
                     class="flaneur-stamp-custom-img"
                     style="transform:rotate(${angle.toFixed(1)}deg);"
                     loading="lazy"
                     onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';">
                <div class="stamp-svg-fallback" style="display:none;width:100%;height:100%;">${svgHtml}</div>
            </div>`;
    }

    /* === 匯出共用介面 === */
    global.FlaneurStampEngine = {
        STAMP_SHAPES,
        STAMP_MOTIFS,
        STAMP_COLORS,
        inferStampPreset,
        inferCountryFromContext,
        cleanPrimarySpotName,
        normalizeForCompare,
        normalizeStampImagePath,
        calcTripDayDate,
        suggestStampNames,
        findSimilarExistingStamps,
        buildStampSvg,
        renderStampVisualHTML
    };
})(window);
