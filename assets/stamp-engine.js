/* =====================================================================
   °•* Flâneur *•° 共用數位景點印章引擎（assets/stamp-engine.js）
   風格融合：JR TRAIN TRIP 數位版畫章 × EKITAG 全國車站章
   架構核心：11 大景點分類 × 15 種外框 × 13 種圖樣 × 11 種標準印章色
   適用頁面：journal.html（收集預覽＆防呆建議）與 passport.html（印章牆渲染＆篩選）
   ===================================================================== */

(function (global) {
    'use strict';

    /* 【⚙️ 功能設定】Cloudflare R2 媒體與景點印章公開網址（結尾不加斜線） */
    const R2_MEDIA_BASE = 'https://pub-180de6e9b96341e68b7fc31ef30c4a2f.r2.dev';
    const R2_STAMPS_BASE = `${R2_MEDIA_BASE}/_stamps`;

    let _svgUid = 0;

    /* === 1. 景點分類（11 類）、外框（15 種）、圖樣（13 種）與標準色盤（11 色） === */
    const STAMP_CATEGORIES = [
        {
            key: 'rail',
            shortLabel: '鐵道交通',
            label: '🚄 鐵道交通（JR 與私鐵車站 / 廢站遺址 / 都市軌道 / 登山纜車 / 新幹線、特急與觀光列車）',
            defaultShape: 'ticket',
            defaultMotif: 'train',
            defaultColor: '#1B5AA6'
        },
        {
            key: 'religion',
            shortLabel: '宗教信仰',
            label: '⛩️ 宗教信仰（神社 / 神宮 / 佛寺 / 參拜巡禮點 / 車站御朱印）',
            defaultShape: 'goshuin',
            defaultMotif: 'shrine',
            defaultColor: '#E0482A'
        },
        {
            key: 'heritage',
            shortLabel: '古蹟街區',
            label: '🏯 古蹟街區（城跡 / 文化財古蹟 / 歷史建築 / 地方老街 / 港灣散策地）',
            defaultShape: 'octagon',
            defaultMotif: 'heritage',
            defaultColor: '#7A4E2D'
        },
        {
            key: 'nature',
            shortLabel: '自然景觀',
            label: '🏔️ 自然景觀（山岳 / 海洋 / 湖泊 / 溪谷 / 海岸與自然公園）',
            defaultShape: 'circle',
            defaultMotif: 'nature',
            defaultColor: '#1E7E46'
        },
        {
            key: 'onsen',
            shortLabel: '溫泉名湯',
            label: '♨️ 溫泉名湯（溫泉鄉 / 秘湯湯屋 / 溫泉街 / 溫泉巡禮點）',
            defaultShape: 'wave',
            defaultMotif: 'onsen',
            defaultColor: '#6E3B8E'
        },
        {
            key: 'gourmet',
            shortLabel: '美食物產',
            label: '🍱 美食物產（車站便當 / 蕎麥麵與地方料理 / 地酒清酒 / 農特產 / 傳統工藝品）',
            defaultShape: 'none',
            defaultMotif: 'food',
            defaultColor: '#EE6D00'
        },
        {
            key: 'wildlife',
            shortLabel: '生態傳說',
            label: '🦊 生態傳說（野生動物 / 海洋生物 / 特有花卉 / 動物雕像 / 地方妖怪與神話傳說）',
            defaultShape: 'oval',
            defaultMotif: 'wildlife',
            defaultColor: '#44AF35'
        },
        {
            key: 'landmark',
            shortLabel: '展館地標',
            label: '🏛️ 展館地標（鐵道與各類博物館 / 展示中心 / 現代建築 / 展望塔 / 運動與休閒設施）',
            defaultShape: 'square',
            defaultMotif: 'landmark',
            defaultColor: '#6B1D2F'
        },
        {
            key: 'festival',
            shortLabel: '藝文祭典',
            label: '🏮 藝文祭典（地方祭典 / 國際藝術祭 / 民俗活動 / 地方產業 / 鐵道職人）',
            defaultShape: 'pentagon',
            defaultMotif: 'festival',
            defaultColor: '#C8282D'
        },
        {
            key: 'seasonal',
            shortLabel: '季節限定',
            label: '❄️ 季節限定（春夏秋冬主題 / 特定節氣 / 賞花與楓雪 / 燈飾列車 / 季節企劃章）',
            defaultShape: 'badge',
            defaultMotif: 'nature',
            defaultColor: '#00ACD1',
            isLimited: true
        },
        {
            key: 'limited',
            shortLabel: '期間限定',
            label: '✨ 期間限定（路線與城市週年紀念 / 車型引退與製造紀念 / 跨路線主題巡禮 / IP 角色與運動聯名 / 特別典藏企劃）',
            defaultShape: 'breakout',
            defaultMotif: 'mascot',
            defaultColor: '#222222',
            isLimited: true
        }
    ];

    const STAMP_SHAPES = [
        { key: 'circle',   label: 'Double-Border Circle / 雙層圓形框' },
        { key: 'oval',     label: 'Oval / 橢圓形框' },
        { key: 'square',   label: 'Rounded Square / 圓角方形框' },
        { key: 'pentagon', label: 'Pentagon / 五角形框' },
        { key: 'hexagon',  label: 'Hexagon / 六角形框' },
        { key: 'octagon',  label: 'Octagon / 八角形框' },
        { key: 'goshuin',  label: 'Vertical Rectangle (Goshuin) / 直式矩形框（御朱印式）' },
        { key: 'arch',     label: 'Arch / 拱形框（建築・隧道式）' },
        { key: 'rings',    label: 'Interlocking Rings / 多圓環交疊框（家紋式）' },
        { key: 'shield',   label: 'Shield & Crest / 盾形徽章框' },
        { key: 'ticket',   label: 'Hard Ticket / 硬券車票框' },
        { key: 'wave',     label: 'Wavy & Postmark / 波浪與風景印戳框' },
        { key: 'badge',    label: 'Decorative & Ribbon Badge / 不規則裝飾與緞帶框' },
        { key: 'breakout', label: 'Breakout Frame / 破框設計' },
        { key: 'none',     label: 'Silhouette / Contour (Frameless) / 物象隨形與無外框' }
    ];

    const STAMP_MOTIFS = [
        { key: 'train',       label: '🚄 Train & Transit / 列車與運具特寫' },
        { key: 'station',     label: '🚉 Station & Rail Structure / 車站建築與鐵道設施' },
        { key: 'kanji_crest', label: '🔰 Kanji-Crest Fusion / 站名漢字與家紋融合' },
        { key: 'shrine',      label: '⛩️ Shrine & Sacred Motif / 社寺建築與神紋鳥居' },
        { key: 'goshuin',     label: '🖌️ Calligraphy & Goshuin / 毛筆書法與御朱印落款' },
        { key: 'heritage',    label: '🏯 Heritage & Townscape / 城郭古蹟與歷史街景' },
        { key: 'nature',      label: '🏔️ Nature & Seasonal Scenery / 山海自然與季節風景' },
        { key: 'onsen',       label: '♨️ Onsen & Bathhouse / 溫泉湯煙與名湯意象' },
        { key: 'food',        label: '🍱 Food, Sake & Craft / 鐵道美食、地酒與工藝' },
        { key: 'wildlife',    label: '🦊 Wildlife & Folklore / 動植物生態與傳說妖怪' },
        { key: 'landmark',    label: '🏛️ Landmark & Museum / 現代地標與展館設施' },
        { key: 'festival',    label: '🏮 Festival & Art / 地方祭典與藝文象徵' },
        { key: 'mascot',      label: '🧢 Staff, Mascot & IP / 鐵道職人與角色 IP' }
    ];

    const STAMP_COLORS = [
        { key: '#222222', label: '墨黑 / Sumi Black' },
        { key: '#C8282D', label: '茜紅 / Crimson Red' },
        { key: '#E0482A', label: '朱紅 / Vermilion' },
        { key: '#6B1D2F', label: '鐵道栗紅 / Maroon' },
        { key: '#EE6D00', label: '東海橙 / Tangerine Orange' },
        { key: '#7A4E2D', label: '焦茶棕 / Dark Brown' },
        { key: '#44AF35', label: '萌黃綠 / Fresh Green' },
        { key: '#1E7E46', label: '常盤綠 / Evergreen' },
        { key: '#00ACD1', label: '晴空水藍 / Sky Blue' },
        { key: '#1B5AA6', label: '紺青藍 / Indigo Blue' },
        { key: '#6E3B8E', label: '江戶紫 / Edo Purple' }
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
        const s = String(raw || '').trim();
        if (!s) return '';
        if (/^(https?:)?\/\//i.test(s) || s.startsWith('data:')) return s;

        const clean = s.replace(/^\/+/, '');
        if (/^(media\/passport\/stamps\/|media\/stamps\/|_stamps\/)/i.test(clean)) {
            const fileName = clean.replace(/^(media\/passport\/stamps\/|media\/stamps\/|_stamps\/)/i, '');
            return `${R2_STAMPS_BASE}/${fileName}`;
        }
        if (clean.includes('/')) {
            return `${R2_MEDIA_BASE}/${clean}`;
        }
        return `${R2_STAMPS_BASE}/${clean}`;
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

    /* === 3. 依 11 大分類自動推斷外框、圖樣、色碼與篩選統計 === */
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

    function inferCategoryFromMeta(name = '', cat = '', isFood = false) {
        const hay = `${name} ${cat}`;
        if (/週年|周年|引退|製造紀念|聯名|巡禮|ラリー|Rally|限定列車|\bSL\b|特別典藏|Suica|拉拉熊/i.test(hay)) return 'limited';
        if (/雪景|冰雪|樹冰|雪原|櫻花|賞櫻|紅葉|賞楓|楓葉|花海|花季|點燈|燈飾|イルミネーション/i.test(hay)) return 'seasonal';
        if (/神社|神宮|寺|廟|宮|鳥居|御朱印|大佛|教堂|清真寺/i.test(hay)) return 'religion';
        if (/溫泉|湯屋|秘湯|澡堂|銀山|藏王溫泉/i.test(hay)) return 'onsen';
        if (/新幹線|Skyliner|ETS|KTM|JR|私鐵|電鐵|地鐵|捷運|單軌|車站|駅|廢站|火車|纜車|ロープウェイ|機場|航空站|航廈/i.test(hay) || cat.includes('交通')) return 'rail';
        if (/城跡|城堡|古城|文化財|遺跡|古蹟|老建築|歷史街區|老街|商店街|港口|港灣|碼頭|阿美橫丁|谷中銀座|雞場街|茨廠街/i.test(hay)) return 'heritage';
        if (/狐狸|動物園|牧場|生態|鳥園|梅花鹿|長尾山雀|河童|妖怪|傳說|海洋生物|花卉/i.test(hay)) return 'wildlife';
        if (isFood || cat.includes('美饌') || /駅弁|便當|蕎麥麵|そば|清酒|地酒|酒造|餐廳|料理|拉麵|牛舌|燒肉|咖啡|茶室|甜點|美食|農產|伴手禮|工藝|Cafe|Coffee/i.test(hay)) return 'gourmet';
        if (/祭典|祭り|藝術祭|花火|民俗|職人|站務員|運轉士|手作|地方產業/i.test(hay)) return 'festival';
        if (/山|峰|峽|溪谷|瀑布|湖|海岸|海灣|海洋|森林|自然公園|夕陽/i.test(hay)) return 'nature';
        if (/博物館|美術館|鐵道館|展示中心|水族館|展望台|摩天輪|鐵塔|雙峰塔|晴空塔|塔|星耀樟宜|球場|Tower|Sky/i.test(hay)) return 'landmark';
        return 'landmark';
    }

    function getCategoryDef(categoryKey) {
        return STAMP_CATEGORIES.find(c => c.key === categoryKey) || STAMP_CATEGORIES[7];
    }

    function filterStampsByCategory(stamps = [], filters = {}) {
        const {
            country = 'ALL',
            category = 'ALL',
            limitedOnly = false
        } = filters;

        return (Array.isArray(stamps) ? stamps : []).filter(st => {
            if (country && country !== 'ALL' && String(st.country || '').trim() !== country) {
                return false;
            }
            const resolvedCat = STAMP_CATEGORIES.some(c => c.key === st.category)
                ? st.category
                : inferCategoryFromMeta(st.name || st.spotName || '', st.categoryLabel || '', Boolean(st.isFood));

            if (category && category !== 'ALL' && resolvedCat !== category) {
                return false;
            }
            if (limitedOnly && !getCategoryDef(resolvedCat).isLimited) {
                return false;
            }
            return true;
        });
    }

    function buildCategoryStats(stamps = [], countryFilter = 'ALL') {
        const list = filterStampsByCategory(stamps, { country: countryFilter });
        const counts = {};
        STAMP_CATEGORIES.forEach(c => { counts[c.key] = 0; });

        let limitedCount = 0;
        list.forEach(st => {
            const resolvedCat = STAMP_CATEGORIES.some(c => c.key === st.category)
                ? st.category
                : inferCategoryFromMeta(st.name || st.spotName || '', st.categoryLabel || '', Boolean(st.isFood));
            if (counts[resolvedCat] !== undefined) counts[resolvedCat]++;
            if (getCategoryDef(resolvedCat).isLimited) limitedCount++;
        });

        return { total: list.length, counts, limitedCount };
    }

    function inferStampPreset(meta = {}) {
        const name = String(meta.name || meta.spotName || meta.title || '').trim();
        const cat = String(meta.categoryLabel || '').trim();
        const region = String(meta.region || '').trim();
        const country = inferCountryFromContext(meta.country, `${name} ${region}`, meta.tripId, meta.timezone);
        const hay = `${name} ${cat}`;

        const hasExplicitCategory = STAMP_CATEGORIES.some(c => c.key === meta.category);
        const categoryKey = hasExplicitCategory
            ? meta.category
            : inferCategoryFromMeta(name, cat, Boolean(meta.isFood));
        const catDef = getCategoryDef(categoryKey);

        let shape = catDef.defaultShape;
        let motif = catDef.defaultMotif;
        let color = catDef.defaultColor;

        // 細粒度微調（對應 TRAIN TRIP × EKITAG 的外框與圖樣習慣）
        if (!hasExplicitCategory) {
            if (categoryKey === 'religion' && /御朱印|朱印/i.test(hay)) {
                shape = 'goshuin'; motif = 'goshuin'; color = '#222222';
            } else if (categoryKey === 'rail' && /隧道|鐵橋|站舍|木造站/i.test(hay)) {
                shape = 'arch'; motif = 'station'; color = '#1B5AA6';
            } else if (categoryKey === 'rail' && /車站|駅/i.test(hay) && !/新幹線|特急|SL|列車/i.test(hay)) {
                shape = 'rings'; motif = 'kanji_crest'; color = '#1B5AA6';
            } else if (categoryKey === 'rail' && /纜車|ロープウェイ/i.test(hay)) {
                shape = 'hexagon'; motif = 'train'; color = '#1B5AA6';
            } else if (categoryKey === 'heritage' && /城跡|城堡|古城/i.test(hay)) {
                shape = 'shield'; motif = 'heritage'; color = '#7A4E2D';
            } else if (categoryKey === 'heritage' && /港灣|港口|碼頭|老街|郵便局/i.test(hay)) {
                shape = 'wave'; motif = 'heritage'; color = '#7A4E2D';
            } else if (categoryKey === 'nature' && /山|峰|峽|高原/i.test(hay)) {
                shape = 'hexagon'; motif = 'nature'; color = '#1E7E46';
            } else if (categoryKey === 'nature' && /海洋|海岸|海灣|湖泊/i.test(hay)) {
                shape = 'wave'; motif = 'nature'; color = '#00ACD1';
            } else if (categoryKey === 'festival' && /職人|站務員|運轉士/i.test(hay)) {
                shape = 'none'; motif = 'mascot'; color = '#7A4E2D';
            }
        }

        return {
            name: cleanPrimarySpotName(name),
            country,
            region: region.replace(/地區/g, '').trim(),
            category: categoryKey,
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

        const arrowBracket = cleaned.match(/^([^（(]+?)\s*[（(]([^）)]+?[→➔][^）)]+?)[）)]$/);
        if (arrowBracket) {
            add(arrowBracket[1].trim());
            arrowBracket[2].split(/[→➔]/).map(s => s.trim()).forEach(add);
        }

        const outerSplitAmp = splitOutsideBrackets(cleaned, /[＆&]/);
        if (outerSplitAmp.length > 1) {
            outerSplitAmp.forEach(part => {
                add(part);
                add(part.replace(/[（(〈《][^）)〉》]*[）)〉》]/g, '').trim());
            });
        }

        add(cleaned.replace(/[（(][^）)]*[）)]/g, '').trim());
        add(cleaned);

        return candidates.slice(0, 5);
    }

    function getBigrams(str) {
        const set = new Set();
        for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
        return set;
    }

    function findSimilarExistingStamps(inputName, existingStamps) {
        const raw = String(inputName || '').trim();
        if (!raw || !Array.isArray(existingStamps) || !existingStamps.length) return [];

        const normInput = normalizeForCompare(raw);
        if (normInput.length < 2) return [];
        const inputAirport = (raw.match(AIRPORT_CODE_RE) || [])[1]?.toUpperCase() || '';

        const byName = new Map();
        existingStamps.forEach(st => {
            const n = String(st.name || '').trim();
            if (!n) return;
            const key = n.toLowerCase();
            if (!byName.has(key)) {
                byName.set(key, {
                    name: n,
                    country: st.country || '',
                    region: st.region || '',
                    category: st.category || '',
                    shape: st.shape,
                    motif: st.motif,
                    color: st.color,
                    customImage: st.customImage || '',
                    dates: new Set()
                });
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

    /* === 5. 13 種單色線條向量圖樣（48×48 畫布） === */
    function getMotifSvgPath(motif) {
        switch (motif) {
            case 'train': // 列車與運具特寫
                return `
                    <rect x="11" y="7" width="26" height="27" rx="8" fill="none" stroke="currentColor" stroke-width="2.1"/>
                    <rect x="15" y="13" width="18" height="7" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/>
                    <circle cx="17" cy="27" r="2" fill="currentColor"/>
                    <circle cx="31" cy="27" r="2" fill="currentColor"/>
                    <path d="M16 34 L11 42 M32 34 L37 42 M13 39 H35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
            case 'station': // 車站建築與鐵道設施
                return `
                    <path d="M7 22 L24 9 L41 22 M11 20 V39 H37 V20 M7 39 H41" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="24" cy="19" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/>
                    <path d="M24 17.5 V19.2 L25.4 20" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                    <path d="M19 39 V29 A5 5 0 0 1 29 29 V39" fill="none" stroke="currentColor" stroke-width="1.9"/>`;
            case 'kanji_crest': // 站名漢字與家紋融合
                return `
                    <circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M14 14 H34 M14 24 H34 M14 34 H34 M24 11 V37" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    <rect x="17" y="17" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
                    <circle cx="24" cy="24" r="2.2" fill="currentColor"/>`;
            case 'shrine': // 社寺建築與神紋鳥居
                return `
                    <path d="M7 12 Q24 16 41 12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
                    <path d="M10 17 H38 M11 23 H37" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M16 17 V41 M32 17 V41 M24 17 V23" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                    <path d="M13 41 H19 M29 41 H35" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`;
            case 'goshuin': // 毛筆書法與御朱印落款
                return `
                    <path d="M16 11 C21 10 27 11 32 10 M24 8 C24 17 23 27 24 37 M17 20 C22 19 27 20 31 19 M15 29 C21 28 28 28 33 27"
                          fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>
                    <rect x="29" y="29" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M32 32 H37 M34.5 32 V37 M32 37 H37" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`;
            case 'heritage': // 城郭古蹟與歷史街景
                return `
                    <path d="M15 17 Q24 11 33 17 H15 Z M11 26 Q24 21 37 26 H11 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    <path d="M18 17 V23 M30 17 V23 M15 26 V32 M33 26 V32" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M9 40 L13 32 H35 L39 40 Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>
                    <path d="M24 8 V12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
            case 'nature': // 山海自然與季節風景
                return `
                    <path d="M5 35 L18 14 L28 29 L34 21 L43 35 Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>
                    <path d="M14 21 L18 23.5 L21 21 L23.5 23" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="34" cy="12" r="3.8" fill="none" stroke="currentColor" stroke-width="1.7"/>
                    <path d="M6 40 Q12 37 18 40 T30 40 T42 40" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`;
            case 'onsen': // 溫泉湯煙與名湯意象
                return `
                    <path d="M16 25 C13 20 19 16 16 10 M24 23 C21 17 27 13 24 7 M32 25 C29 20 35 16 32 10"
                          fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
                    <path d="M11 29 C7 31 8 38 24 38 C40 38 41 31 37 29" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`;
            case 'food': // 鐵道美食、地酒與工藝
                return `
                    <path d="M17 17 C15 13 19 12 17 8 M24 16 C22 12 26 11 24 7 M31 17 C29 13 33 12 31 8"
                          fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M9 22 H39 C39 32 33 37 24 37 C15 37 9 32 9 22 Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>
                    <path d="M17 37 V40 H31 V37 M27 22 L40 13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`;
            case 'wildlife': // 動植物生態與傳說妖怪
                return `
                    <path d="M11 11 L19 17 H29 L37 11 L39 25 L24 39 L9 25 Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>
                    <path d="M15 24 L19 25 M33 24 L29 25 M14 14 L16 19 M34 14 L32 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    <circle cx="24" cy="34" r="2.2" fill="currentColor"/>`;
            case 'landmark': // 現代地標與展館設施
                return `
                    <path d="M24 6 V12 M21 12 H27 L31 30 L37 41 H29 C28 36 20 36 19 41 H11 L17 30 Z"
                          fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                    <path d="M16 24 H32 M18 31 H30 M19 19 L29 24 M29 19 L19 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`;
            case 'festival': // 地方祭典與藝文象徵
                return `
                    <path d="M18 11 H30 M24 7 V11 M18 35 H30 M24 35 V41" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <ellipse cx="24" cy="23" rx="11" ry="12" fill="none" stroke="currentColor" stroke-width="2.1"/>
                    <path d="M14 18 H34 M13 23 H35 M14 28 H34" stroke="currentColor" stroke-width="1.4"/>`;
            case 'mascot': // 鐵道職人與角色 IP
                return `
                    <path d="M10 21 C10 13 16 10 24 10 C32 10 38 13 38 21 L35 28 H13 Z" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>
                    <path d="M12 28 C16 33 32 33 36 28" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
                    <path d="M14 24 H34" stroke="currentColor" stroke-width="1.6"/>
                    <circle cx="24" cy="17.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/>
                    <path d="M17 36 H31" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="2 3"/>`;
            default:
                return `
                    <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2.5"/>
                    <path d="M24 9 L27.5 20.5 L39 24 L27.5 27.5 L24 39 L20.5 27.5 L9 24 L20.5 20.5 Z"
                          fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
                    <circle cx="24" cy="24" r="2.3" fill="currentColor"/>`;
        }
    }

    /* === 6. 15 種外框繪製（留足安全邊距，完整不裁切） === */
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
            case 'oval':
                return `
                    <ellipse cx="100" cy="100" rx="92" ry="74" fill="none" stroke="currentColor" stroke-width="2.8"/>
                    <ellipse cx="100" cy="100" rx="85" ry="67" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3.5 2.5"/>`;
            case 'square':
                return `
                    <rect x="15" y="15" width="170" height="170" rx="18" fill="none" stroke="currentColor" stroke-width="2.8"/>
                    <rect x="22" y="22" width="156" height="156" rx="13" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 3"/>`;
            case 'pentagon':
                return `
                    <polygon points="${buildRegularPolyPoints(100, 104, 90, 5, -90)}" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round"/>
                    <polygon points="${buildRegularPolyPoints(100, 104, 82, 5, -90)}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 2.5" stroke-linejoin="round"/>`;
            case 'hexagon':
                return `
                    <polygon points="${buildRegularPolyPoints(100, 100, 92, 6, -90)}" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round"/>
                    <polygon points="${buildRegularPolyPoints(100, 100, 84, 6, -90)}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 2.5" stroke-linejoin="round"/>`;
            case 'octagon':
                return `
                    <polygon points="${buildRegularPolyPoints(100, 100, 92, 8, 22.5)}" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round"/>
                    <polygon points="${buildRegularPolyPoints(100, 100, 84, 8, 22.5)}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 2.5" stroke-linejoin="round"/>`;
            case 'goshuin':
                return `
                    <rect x="30" y="12" width="140" height="176" rx="4" fill="none" stroke="currentColor" stroke-width="2.8"/>
                    <rect x="37" y="19" width="126" height="162" rx="2" fill="none" stroke="currentColor" stroke-width="1.15"/>
                    <rect x="139" y="155" width="16" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.7"/>`;
            case 'arch':
                return `
                    <path d="M 22 178 V 92 A 78 78 0 0 1 178 92 V 178 Z" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round"/>
                    <path d="M 29 171 V 92 A 71 71 0 0 1 171 92 V 171 Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 2.5" stroke-linejoin="round"/>`;
            case 'rings':
                return `
                    <circle cx="100" cy="64" r="46" fill="none" stroke="currentColor" stroke-width="2.3"/>
                    <circle cx="100" cy="136" r="46" fill="none" stroke="currentColor" stroke-width="2.3"/>
                    <circle cx="64" cy="100" r="46" fill="none" stroke="currentColor" stroke-width="2.3"/>
                    <circle cx="136" cy="100" r="46" fill="none" stroke="currentColor" stroke-width="2.3"/>
                    <circle cx="100" cy="100" r="76" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3.5 2.5"/>`;
            case 'shield':
                return `
                    <path d="M 30 22 H 170 V 96 C 170 142 135 170 100 184 C 65 170 30 142 30 96 Z"
                          fill="none" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round"/>
                    <path d="M 37 29 H 163 V 95 C 163 135 132 160 100 174 C 68 160 37 135 37 95 Z"
                          fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="4 2.5" stroke-linejoin="round"/>`;
            case 'ticket':
                return `
                    <path d="M 22 25 H 178 A 10 10 0 0 1 188 35 V 87 A 13 13 0 0 0 188 113 V 165 A 10 10 0 0 1 178 175 H 22 A 10 10 0 0 1 12 165 V 113 A 13 13 0 0 0 12 87 V 35 A 10 10 0 0 1 22 25 Z"
                          fill="none" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round"/>
                    <rect x="24" y="32" width="152" height="136" rx="6" fill="none" stroke="currentColor" stroke-width="1.15" stroke-dasharray="4 3"/>`;
            case 'wave':
                return `
                    <path d="${buildWavyCirclePath(100, 100, 90, 24, 3.0)}" fill="none" stroke="currentColor" stroke-width="2.6"/>
                    <circle cx="100" cy="100" r="81" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 2.5"/>`;
            case 'badge':
                return `
                    <path d="${buildWavyCirclePath(100, 100, 88, 16, 4.5)}" fill="none" stroke="currentColor" stroke-width="2.6"/>
                    <circle cx="100" cy="100" r="78" fill="none" stroke="currentColor" stroke-width="1.15" stroke-dasharray="3 2.5"/>
                    <path d="M 48 160 L 38 184 L 54 176 L 64 186 L 70 166 M 152 160 L 162 184 L 146 176 L 136 186 L 130 166"
                          fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`;
            case 'breakout':
                return `
                    <path d="M 134 38 A 82 82 0 1 1 66 38" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                    <path d="M 130 45 A 74 74 0 1 1 70 45" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3.5 2.5" stroke-linecap="round"/>`;
            case 'none':
                return `
                    <line x1="48" y1="34" x2="152" y2="34" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.5"/>
                    <line x1="48" y1="166" x2="152" y2="166" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.5"/>`;
            default: // circle（雙層圓形框）
                return `
                    <circle cx="100" cy="100" r="91" fill="none" stroke="currentColor" stroke-width="3"/>
                    <circle cx="100" cy="100" r="84" fill="none" stroke="currentColor" stroke-width="1.2"/>
                    <circle cx="25" cy="100" r="2.1" fill="currentColor" opacity="0.75"/>
                    <circle cx="175" cy="100" r="2.1" fill="currentColor" opacity="0.75"/>`;
        }
    }

    /* === 7. 站點名稱智慧斷行（避免超出印章外框） === */
    function splitStampTitleLines(title, maxCharsPerLine = 7) {
        const clean = String(title || '旅途印記').trim();
        if (clean.length <= maxCharsPerLine) return [clean];

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
        const color = stamp.color || '#1B5AA6';
        const dateLabel = formatStampDate(stamp.date);

        const countryEn = COUNTRY_EN_MAP[country] || (country ? country.toUpperCase() : 'TRAVEL');
        const regionShort = region.replace(/地區/g, '').split(/[・｜|]/)[0].trim();
        const topLabel = regionShort && regionShort !== country
            ? `${countryEn} ・ ${regionShort}`
            : countryEn;

        const isCurved = (shape === 'circle' || shape === 'wave' || shape === 'badge');
        const maxPerLine = (shape === 'goshuin')
            ? 5
            : ((shape === 'hexagon' || shape === 'pentagon' || shape === 'shield' || shape === 'rings') ? 6 : 7);

        const lines = splitStampTitleLines(name, maxPerLine);
        const maxLineLen = Math.max(...lines.map(l => l.length));

        let titleFontSize = 15.5;
        if (lines.length === 1) titleFontSize = maxLineLen >= 7 ? 14 : 16.5;
        else if (lines.length === 2) titleFontSize = maxLineLen >= 8 ? 12.5 : 14;
        else titleFontSize = 11.8;

        const lineHeight = titleFontSize + 3.5;
        const baseStartY = shape === 'breakout' ? 106 : 124;
        const startY = lines.length === 1
            ? baseStartY
            : (lines.length === 2 ? baseStartY - 8 : baseStartY - 14);

        const titleTspans = lines.map((line, i) =>
            `<tspan x="100" y="${(startY + i * lineHeight).toFixed(1)}">${escSvg(line)}</tspan>`
        ).join('');

        const angle = options.noTilt ? 0 : (((hashString(name) % 70) - 35) / 10);

        let headerFooterSvg = '';
        let defsSvg = '';

        if (isCurved) {
            const topR = shape === 'wave' ? 68 : (shape === 'badge' ? 65 : 71);
            const botR = shape === 'wave' ? 70 : (shape === 'badge' ? 67 : 73);
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
        } else if (shape === 'breakout') {
            headerFooterSvg = `
                <text x="100" y="151" text-anchor="middle" font-size="9.2" font-weight="700" letter-spacing="1.4" fill="currentColor" opacity="0.86">${escSvg(topLabel)}</text>
                <line x1="60" y1="158" x2="140" y2="158" stroke="currentColor" stroke-width="0.9" stroke-dasharray="2.5 2.5" opacity="0.55"/>
                <text x="100" y="170" text-anchor="middle" font-size="9.2" font-weight="700" letter-spacing="1.5" fill="currentColor" opacity="0.82">${escSvg(dateLabel)}</text>`;
        } else {
            const topYMap = {
                goshuin: 35, oval: 46, pentagon: 55, hexagon: 47,
                arch: 48, rings: 48, shield: 43, ticket: 47
            };
            const botYMap = {
                goshuin: 168, oval: 156, pentagon: 166, hexagon: 160,
                arch: 164, rings: 158, shield: 156, ticket: 158
            };
            const topY = topYMap[shape] || 42;
            const botY = botYMap[shape] || 162;
            const dividerW = (shape === 'goshuin' || shape === 'hexagon' || shape === 'pentagon') ? 36 : 48;

            headerFooterSvg = `
                <text x="100" y="${topY}" text-anchor="middle" font-size="9.2" font-weight="700" letter-spacing="1.4" fill="currentColor" opacity="0.86">${escSvg(topLabel)}</text>
                <line x1="${100 - dividerW}" y1="${botY - 13}" x2="${100 + dividerW}" y2="${botY - 13}" stroke="currentColor" stroke-width="0.9" stroke-dasharray="2.5 2.5" opacity="0.55"/>
                <text x="100" y="${botY}" text-anchor="middle" font-size="9.2" font-weight="700" letter-spacing="1.5" fill="currentColor" opacity="0.82">${escSvg(dateLabel)}</text>`;
        }

        const motifYMap = {
            breakout: 24, pentagon: 60, hexagon: 54, goshuin: 50,
            oval: 54, arch: 55, rings: 54
        };
        const motifTranslateY = isCurved ? 52 : (motifYMap[shape] || 50);

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

    /* === 9. 統一渲染入口（支援自訂圖片、限定分類徽章＋失敗自動退回 SVG） === */
    function renderStampVisualHTML(stamp = {}, options = {}) {
        const svgHtml = buildStampSvg(stamp, options);
        const imgPath = normalizeStampImagePath(stamp.customImage);
        const catDef = getCategoryDef(
            STAMP_CATEGORIES.some(c => c.key === stamp.category)
                ? stamp.category
                : inferCategoryFromMeta(stamp.name || stamp.spotName || '', stamp.categoryLabel || '', Boolean(stamp.isFood))
        );

        const showLimitedBadge = Boolean(catDef.isLimited) && !options.hideLimitedBadge;
        const badgeHtml = showLimitedBadge
            ? `<span class="stamp-special-pill" data-category="${escSvg(catDef.key)}" title="${escSvg(catDef.shortLabel)}">★ ${escSvg(catDef.shortLabel)}</span>`
            : '';
        const boxClass = `stamp-visual-box${showLimitedBadge ? ' is-special-stamp' : ''}`;

        if (!imgPath) {
            return `<div class="${boxClass}">${svgHtml}${badgeHtml}</div>`;
        }
        const angle = options.noTilt ? 0 : (((hashString(stamp.name || '') % 70) - 35) / 10);
        return `
            <div class="${boxClass}">
                <img src="${escSvg(imgPath)}" alt="${escSvg(stamp.name || '自訂印章')}"
                     class="flaneur-stamp-custom-img"
                     style="transform:rotate(${angle.toFixed(1)}deg);"
                     loading="lazy"
                     onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';">
                <div class="stamp-svg-fallback" style="display:none;width:100%;height:100%;">${svgHtml}</div>
                ${badgeHtml}
            </div>`;
    }

    /* === 匯出共用介面 === */
    global.FlaneurStampEngine = {
        R2_MEDIA_BASE,
        R2_STAMPS_BASE,
        STAMP_CATEGORIES,
        STAMP_SHAPES,
        STAMP_MOTIFS,
        STAMP_COLORS,
        getCategoryDef,
        inferCategoryFromMeta,
        inferStampPreset,
        inferCountryFromContext,
        filterStampsByCategory,
        buildCategoryStats,
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
