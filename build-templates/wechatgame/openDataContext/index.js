var env = (typeof GameGlobal !== 'undefined' && (GameGlobal.wx || GameGlobal.tt || GameGlobal.swan)) || (typeof wx !== 'undefined' ? wx : null);
var sharedCanvas = env && env.getSharedCanvas ? env.getSharedCanvas() : null;
var ctx = sharedCanvas ? sharedCanvas.getContext('2d') : null;

var currentKey = 'level';
var currentTitle = '好友排行';
var currentScoreLabel = '通过关卡';
var currentEmptyText = '暂无好友排行';
var currentFallbackSelf = null;
var currentRankNames = ['青铜', '白银', '黄金', '铂金', '钻石', '星耀', '王者', '无双', '荣耀', '至尊'];
var currentRankStartLevels = [1, 7, 19, 31, 43, 55, 67, 79, 91, 103];
var currentTierIconPaths = [
    'openDataContext/tier1.png',
    'openDataContext/tier2.png',
    'openDataContext/tier3.png',
    'openDataContext/tier4.png',
    'openDataContext/tier5.png',
    'openDataContext/tier6.png',
    'openDataContext/tier7.png',
    'openDataContext/tier8.png',
    'openDataContext/tier9.png',
    'openDataContext/tier10.png',
];
var imageCache = {};
var rankBgPaths = {
    self: ['openDataContext/bg1.png'],
    other: ['openDataContext/bg2.png'],
};
var rankMedalPaths = ['openDataContext/1.png', 'openDataContext/2.png', 'openDataContext/3.png'];
var headBgPath = 'openDataContext/headBg.png';
var defaultHeadPath = 'openDataContext/defaultHead.png';
var rankItemBase = {
    viewportWidth: 640,
    left: 25.6,
    width: 576,
    height: 74,
    gap: 2,
    top: 520,
    rankX: 49.18976,
    medalX: 49.89184,
    avatarX: 128.048,
    nameX: 221.43296,
    tierIconX: 328.78016,
    tierNameX: 387.74912,
    scoreX: 490.77312,
    medalWidth: 80.384,
    medalHeights: [52.736, 53.248, 52.736],
    avatarSize: 64.64,
    avatarInset: 5.12,
    tierIconWidth: 51.2,
    tierIconHeight: 49.152,
    rankFontSize: 35.2,
    textFontSize: 23.04,
    textOutlineWidth: 1.28,
};
var topRankBase = [
    { centerX: 320, centerY: 317, nameY: 393, avatarSize: 101 },
    { centerX: 141, centerY: 352, nameY: 428, avatarSize: 101 },
    { centerX: 499, centerY: 368, nameY: 444, avatarSize: 101 },
];

function clearCanvas() {
    if (!ctx || !sharedCanvas) return;
    ctx.clearRect(0, 0, sharedCanvas.width, sharedCanvas.height);
}

function parseScore(item, key) {
    var list = item && item.KVDataList;
    if (!Array.isArray(list)) return 0;

    var kv = null;
    for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].key === key) {
            kv = list[i];
            break;
        }
    }
    if (!kv && list.length > 0) kv = list[0];
    if (!kv || !kv.value) return 0;

    try {
        var value = JSON.parse(kv.value);
        var score = value && value.wxgame ? Number(value.wxgame.score) : Number(value.score);
        return isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
    } catch (e) {
        return 0;
    }
}

function syncRankTierConfig(data) {
    if (Array.isArray(data.rankNames) && data.rankNames.length) {
        currentRankNames = data.rankNames.map(function(name) {
            return String(name || '');
        });
    }

    if (Array.isArray(data.rankStartLevels) && data.rankStartLevels.length) {
        currentRankStartLevels = data.rankStartLevels.map(function(level) {
            var value = Number(level);
            return isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
        });
    }

    if (Array.isArray(data.tierIconPaths) && data.tierIconPaths.length) {
        currentTierIconPaths = data.tierIconPaths.map(function(path) {
            return String(path || '');
        });
    }
}

function getRankTier(level) {
    var rankCount = Math.min(currentRankNames.length, currentRankStartLevels.length);
    if (rankCount <= 0) return null;

    var normalizedLevel = Number(level);
    if (!isFinite(normalizedLevel)) normalizedLevel = 1;
    normalizedLevel = Math.max(1, Math.floor(normalizedLevel));

    var rankIndex = 0;
    for (var i = rankCount - 1; i >= 0; i--) {
        if (normalizedLevel >= currentRankStartLevels[i]) {
            rankIndex = i;
            break;
        }
    }

    return {
        name: currentRankNames[rankIndex] || '',
        iconPath: currentTierIconPaths[rankIndex] || '',
    };
}

function normalizeRankData(rawData, key) {
    var data = Array.isArray(rawData) ? rawData.slice() : [];
    for (var i = 0; i < data.length; i++) {
        data[i].rankScore = parseScore(data[i], key);
    }

    data.sort(function(a, b) {
        return b.rankScore - a.rankScore;
    });

    return data.filter(function(item) {
        return item.rankScore > 0;
    }).slice(0, 10);
}

function normalizeFallbackSelf(data) {
    if (!data) return null;
    var rawScore = data.rankScore != null ? data.rankScore : data.score;
    var score = Number(rawScore);
    if (!isFinite(score)) score = 0;
    return {
        nickname: data.nickname || data.name || 'Me',
        avatarUrl: data.avatarUrl || data.avatar || '',
        openid: data.openid || data.uid || data.userId || '',
        uid: data.uid || data.openid || data.userId || '',
        rankScore: Math.max(0, Math.floor(score)),
        isSelf: true,
        isSelfFallback: true,
    };
}

function getFallbackRankData() {
    var self = normalizeFallbackSelf(currentFallbackSelf);
    return self ? [self] : [];
}

function getRankUserId(item) {
    return item ? (item.openid || item.uid || item.userId || '') : '';
}

function isSameRankUser(item, self) {
    if (!item || !self) return false;
    var itemId = getRankUserId(item);
    var selfId = getRankUserId(self);
    if (itemId && selfId && itemId === selfId) return true;
    return !!self.avatarUrl
        && item.avatarUrl === self.avatarUrl
        && item.nickname === self.nickname;
}

function mergeFallbackSelf(rankData) {
    var data = Array.isArray(rankData) ? rankData.slice() : [];
    var self = normalizeFallbackSelf(currentFallbackSelf);
    if (!self) return data;

    var hasSelf = false;
    for (var i = 0; i < data.length; i++) {
        if (data[i].isSelf || data[i].isSelfFallback || isSameRankUser(data[i], self)) {
            data[i].isSelf = true;
            hasSelf = true;
        }
    }

    if (!hasSelf) data.push(self);
    data.sort(function(a, b) {
        return b.rankScore - a.rankScore;
    });

    var selfIndex = data.indexOf(self);
    if (selfIndex >= 10) {
        return data.slice(0, 9).concat([self]);
    }
    return data.slice(0, 10);
}

function drawFallbackOrEmpty() {
    var fallbackData = getFallbackRankData();
    if (fallbackData.length) {
        drawRankList(fallbackData);
    } else {
        drawEmpty();
    }
}

function traceRoundRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function drawRoundRect(x, y, width, height, radius, color) {
    traceRoundRect(x, y, width, height, radius);
    ctx.fillStyle = color;
    ctx.fill();
}

function getCachedImage(src) {
    if (!src || !env) return null;
    var cached = imageCache[src];
    if (cached && cached._rankLoaded) return cached;
    if (cached) return null;

    var image = env.createImage ? env.createImage() : null;
    if (!image) return null;
    image.onload = function() {
        image._rankLoaded = true;
        drawRankList(lastRankData);
    };
    image.onerror = function() {
        image._rankFailed = true;
    };
    image.src = src;
    imageCache[src] = image;
    return null;
}

function isSelfRankItem(item) {
    return !!(item && (item.isSelf || item.isSelfFallback));
}

function drawRankBackground(isSelf, x, y, width, height) {
    var sources = isSelf ? rankBgPaths.self : rankBgPaths.other;
    for (var i = 0; i < sources.length; i++) {
        var image = getCachedImage(sources[i]);
        if (image) {
            try {
                ctx.drawImage(image, x, y, width, height);
                return;
            } catch (e) {}
        }
    }

    drawRoundRect(x, y, width, height, 10, isSelf ? '#f4d8aa' : '#efd09a');
}

function drawText(text, x, y, size, color, align, bold) {
    ctx.fillStyle = color;
    ctx.font = (bold ? 'bold ' : '') + size + 'px Arial';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
}

function drawRankText(text, x, y, size, outlineWidth) {
    ctx.font = size + 'px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#8b3a1a';
    ctx.lineWidth = outlineWidth * 2;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y);
}

function drawImageAsset(src, x, y, width, height) {
    var image = getCachedImage(src);
    if (!image) return false;
    try {
        ctx.drawImage(image, x, y, width, height);
        return true;
    } catch (e) {
        return false;
    }
}

function drawImageInBox(image, x, y, width, height, mode) {
    try {
        var iw = image.width || image.naturalWidth || width;
        var ih = image.height || image.naturalHeight || height;
        if (!iw || !ih) {
            ctx.drawImage(image, x, y, width, height);
            return true;
        }

        var scale = mode === 'cover' ? Math.max(width / iw, height / ih) : Math.min(width / iw, height / ih);
        var drawW = iw * scale;
        var drawH = ih * scale;
        ctx.drawImage(image, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH);
        return true;
    } catch (e) {
        return false;
    }
}

function drawImageFit(src, x, y, width, height) {
    var image = getCachedImage(src);
    if (!image) return false;
    return drawImageInBox(image, x, y, width, height, 'contain');
}

function drawImageCover(image, x, y, width, height) {
    return drawImageInBox(image, x, y, width, height, 'cover');
}

function clipText(text, maxChars) {
    text = text || '好友';
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 1) + '…';
}

function drawAvatar(url, x, y, size, fallbackText) {
    var radius = Math.max(8, size * 0.18);
    if (!drawImageAsset(headBgPath, x, y, size, size)) {
        drawRoundRect(x, y, size, size, radius, '#f2d29b');
    }

    var inset = rankItemBase.avatarInset * (size / rankItemBase.avatarSize);
    var innerX = x + inset;
    var innerY = y + inset;
    var innerSize = Math.max(0, size - inset * 2);

    var cached = imageCache[url];
    if (cached && cached._rankLoaded) {
        drawImageCover(cached, innerX, innerY, innerSize, innerSize);
        return;
    }

    var drewDefault = drawImageFit(defaultHeadPath, x, y, size, size);
    if (!drewDefault) {
        drawText((fallbackText || '?').slice(0, 1), x + size / 2, y + size / 2 + 1, Math.max(18, size * 0.46), '#8f4b25', 'center', true);
    }

    if (!url || !env) return;

    if (cached) return;
    var image = env.createImage ? env.createImage() : null;
    if (!image) return;
    image.onload = function() {
        image._rankLoaded = true;
        drawRankList(lastRankData);
    };
    image.onerror = function() {
        image._rankFailed = true;
    };
    image.src = url;
    imageCache[url] = image;
}

var lastRankData = [];

function drawEmpty() {
    clearCanvas();
    drawText(currentEmptyText, sharedCanvas.width / 2, sharedCanvas.height / 2, 34, '#9b6b3a', 'center', true);
}

function drawTopRankList(data, scale) {
    var topCount = Math.min(3, data.length);
    for (var i = 0; i < topCount; i++) {
        var item = data[i];
        var layout = topRankBase[i];
        var avatarSize = layout.avatarSize * scale;
        var centerX = layout.centerX * scale;
        var centerY = layout.centerY * scale;
        drawAvatar(
            item.avatarUrl,
            centerX - avatarSize / 2,
            centerY - avatarSize / 2,
            avatarSize,
            item.nickname
        );
        drawRankText(
            clipText(item.nickname, 7),
            centerX,
            layout.nameY * scale,
            rankItemBase.textFontSize * scale,
            rankItemBase.textOutlineWidth * scale
        );
    }
}

function drawRankList(data) {
    if (!ctx || !sharedCanvas) return;
    lastRankData = data || [];
    clearCanvas();

    if (!lastRankData.length) {
        drawEmpty();
        return;
    }

    var width = sharedCanvas.width;
    var rowScale = width / rankItemBase.viewportWidth;
    var rowWidth = rankItemBase.width * rowScale;
    var rowHeight = rankItemBase.height * rowScale;
    var rowGap = rankItemBase.gap * rowScale;
    var startY = rankItemBase.top * rowScale;
    var rowX = rankItemBase.left * rowScale;
    var avatarSize = rankItemBase.avatarSize * rowScale;
    var medalWidth = rankItemBase.medalWidth * rowScale;
    var rankFontSize = rankItemBase.rankFontSize * rowScale;
    var textFontSize = rankItemBase.textFontSize * rowScale;
    var textOutlineWidth = rankItemBase.textOutlineWidth * rowScale;
    drawTopRankList(lastRankData, rowScale);

    for (var i = 3; i < lastRankData.length; i++) {
        var item = lastRankData[i];
        var y = startY + (i - 3) * (rowHeight + rowGap);
        var centerY = y + rowHeight / 2;
        var rankX = rowX + rankItemBase.rankX * rowScale;
        var medalX = rowX + rankItemBase.medalX * rowScale;
        var avatarX = rowX + rankItemBase.avatarX * rowScale - avatarSize / 2;
        var nameX = rowX + rankItemBase.nameX * rowScale;
        var scoreX = rowX + rankItemBase.scoreX * rowScale;
        drawRankBackground(isSelfRankItem(item), rowX, y, rowWidth, rowHeight);

        drawRankText(String(i + 1), rankX, centerY, rankFontSize, textOutlineWidth);

        drawAvatar(item.avatarUrl, avatarX, centerY - avatarSize / 2, avatarSize, item.nickname);
        drawRankText(clipText(item.nickname, 8), nameX, centerY, textFontSize, textOutlineWidth);
        drawRankText(String(item.rankScore), scoreX, centerY, textFontSize, textOutlineWidth);
    }
}

function requestFriendRank(key) {
    if (!env || !env.getFriendCloudStorage) {
        drawFallbackOrEmpty();
        return;
    }

    env.getFriendCloudStorage({
        keyList: [key],
        success: function(res) {
            drawRankList(mergeFallbackSelf(normalizeRankData(res && res.data, key)));
        },
        fail: function() {
            drawFallbackOrEmpty();
        },
    });
}

function handleMessage(data) {
    if (!data) return;

    if (data.type === 'clear') {
        clearCanvas();
        return;
    }

    if (data.type === 'engine') {
        drawRankList(lastRankData);
        return;
    }

    if (data.type === 'rankData' || data.type === 'winStreak') {
        currentKey = data.key || (data.type === 'winStreak' ? 'winsk' : 'level');
        currentTitle = data.title || currentTitle;
        currentScoreLabel = data.scoreLabel || currentScoreLabel;
        currentEmptyText = data.emptyText || currentEmptyText;
        currentFallbackSelf = data.fallbackSelf || null;
        syncRankTierConfig(data);
        requestFriendRank(currentKey);
    }
}

if (env && env.onMessage) {
    env.onMessage(handleMessage);
}

clearCanvas();
