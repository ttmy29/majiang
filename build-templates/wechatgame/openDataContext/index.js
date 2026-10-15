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
var selfRankBgPath = 'openDataContext/selfRankBg.png';
var currentSelfRank = null;
var rankScrollOffset = 0;
var rankViewActive = false;
var rankRequestToken = 0;
var selfRankFooterTop = 919.52;
var rankItemBase = {
    viewportWidth: 640,
    left: 57.92,
    width: 524.16,
    height: 88.96,
    gap: 3.84,
    top: 544,
    rankX: 50,
    medalX: 49.89184,
    avatarX: 128.048,
    nameX: 195.2,
    nameWidth: 185.6,
    tierIconX: 328.78016,
    tierNameX: 387.74912,
    scoreX: 510.72,
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
    { centerX: 320, centerY: 304, nameY: 370, scoreY: 398, avatarSize: 78 },
    { centerX: 141, centerY: 339, nameY: 397, scoreY: 425, avatarSize: 78 },
    { centerX: 499, centerY: 355, nameY: 413, scoreY: 441, avatarSize: 78 },
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
    });
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
            data[i].rankScore = Math.max(data[i].rankScore, self.rankScore);
            hasSelf = true;
        }
    }

    if (!hasSelf) data.push(self);
    data.sort(function(a, b) {
        return b.rankScore - a.rankScore;
    });

    currentSelfRank = null;
    for (var rank = 0; rank < data.length; rank++) {
        data[rank].rank = rank + 1;
        if (isSelfRankItem(data[rank])) currentSelfRank = data[rank];
    }
    return data.slice(0, 10);
}

function drawFallbackOrEmpty() {
    currentSelfRank = normalizeFallbackSelf(currentFallbackSelf);
    drawRankList([]);
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

function drawRankText(text, x, y, size, outlineWidth, align, maxWidth) {
    ctx.font = size + 'px Arial';
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    if (maxWidth && ctx.measureText) {
        while (text.length > 1 && ctx.measureText(text).width > maxWidth) {
            text = text.slice(0, -2) + '…';
        }
    }
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
    if (typeof url !== 'string' || url.toLowerCase().indexOf('1.jpg') !== -1) url = '';
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
            rankItemBase.textOutlineWidth * scale,
            'center',
            160 * scale
        );
        drawRankText(
            currentKey === 'winsk' ? String(item.rankScore) + '连胜' : '第' + String(item.rankScore) + '关',
            centerX,
            layout.scoreY * scale,
            rankItemBase.textFontSize * scale,
            rankItemBase.textOutlineWidth * scale,
            'center',
            160 * scale
        );
    }
}

function drawSelfRankFooter(data, scale) {
    var self = currentSelfRank;
    if (!self) {
        for (var i = 0; i < data.length; i++) {
            if (isSelfRankItem(data[i])) self = data[i];
        }
    }
    var x = rankItemBase.left * scale;
    var y = selfRankFooterTop * scale;
    var width = rankItemBase.width * scale;
    var height = rankItemBase.height * scale;
    var centerY = y + height / 2;
    var fontSize = 28.16 * scale;
    var outline = rankItemBase.textOutlineWidth * scale;
    if (!drawImageAsset(selfRankBgPath, x, y, width, height)) {
        drawRoundRect(x, y, width, height, 12 * scale, '#7eac5c');
    }
    drawRankText('我的排名', x + 8.64 * scale, centerY, fontSize, outline, 'left');
    var rank = self && self.rank > 0 ? self.rank : 0;
    var rankX = x + 191.68 * scale;
    if (rank >= 1 && rank <= 3) {
        if (!drawImageAsset(rankMedalPaths[rank - 1], rankX - 40 * scale, centerY - 26.56 * scale, 80 * scale, 53.12 * scale)) {
            drawRankText(String(rank), rankX, centerY, fontSize, outline);
        }
    } else {
        drawRankText(rank > 0 ? String(rank) : '未上榜', rankX, centerY, fontSize, outline);
    }
    drawRankText(currentScoreLabel, x + 252.48 * scale, centerY, fontSize, outline, 'left');
    var score = self ? self.rankScore : Number(currentFallbackSelf && currentFallbackSelf.rankScore) || 0;
    drawRankText(String(score) + (currentKey === 'winsk' ? '胜' : '关'), x + 510.72 * scale, centerY, fontSize, outline, 'right');
}

function drawRankList(data) {
    if (!ctx || !sharedCanvas || !rankViewActive) return;
    lastRankData = data || [];
    clearCanvas();

    if (!lastRankData.length) {
        drawEmpty();
        drawSelfRankFooter([], sharedCanvas.width / rankItemBase.viewportWidth);
        return;
    }

    var width = sharedCanvas.width;
    var rowScale = width / rankItemBase.viewportWidth;
    var rowWidth = rankItemBase.width * rowScale;
    var rowHeight = rankItemBase.height * rowScale;
    var rowGap = rankItemBase.gap * rowScale;
    var startY = (rankItemBase.top - rankScrollOffset) * rowScale;
    var rowX = rankItemBase.left * rowScale;
    var avatarSize = rankItemBase.avatarSize * rowScale;
    var medalWidth = rankItemBase.medalWidth * rowScale;
    var rankFontSize = rankItemBase.rankFontSize * rowScale;
    var textFontSize = rankItemBase.textFontSize * rowScale;
    var textOutlineWidth = rankItemBase.textOutlineWidth * rowScale;
    drawTopRankList(lastRankData, rowScale);

    ctx.save();
    ctx.beginPath();
    ctx.rect(rowX, rankItemBase.top * rowScale, rowWidth, (selfRankFooterTop - 8 - rankItemBase.top) * rowScale);
    ctx.clip();
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

        drawRankText(String(item.rank || i + 1), rankX, centerY, rankFontSize, textOutlineWidth);

        drawAvatar(item.avatarUrl, avatarX, centerY - avatarSize / 2, avatarSize, item.nickname);
        drawRankText(clipText(item.nickname, 16), nameX, centerY, textFontSize, textOutlineWidth, 'left', rankItemBase.nameWidth * rowScale);
        drawRankText(currentKey === 'winsk' ? String(item.rankScore) + '连胜' : '第' + String(item.rankScore) + '关', scoreX, centerY, textFontSize, textOutlineWidth, 'right');
    }
    ctx.restore();
    drawSelfRankFooter(lastRankData, rowScale);
}

function requestFriendRank(key) {
    var requestToken = ++rankRequestToken;
    if (!env || !env.getFriendCloudStorage) {
        drawFallbackOrEmpty();
        return;
    }

    env.getFriendCloudStorage({
        keyList: [key],
        success: function(res) {
            if (!rankViewActive || requestToken !== rankRequestToken) return;
            drawRankList(mergeFallbackSelf(normalizeRankData(res && res.data, key)));
        },
        fail: function() {
            if (!rankViewActive || requestToken !== rankRequestToken) return;
            drawFallbackOrEmpty();
        },
    });
}

function handleMessage(data) {
    if (!data) return;

    if (data.type === 'clear') {
        rankViewActive = false;
        rankRequestToken++;
        lastRankData = [];
        currentSelfRank = null;
        rankScrollOffset = 0;
        clearCanvas();
        return;
    }

    if (data.type === 'engine') {
        drawRankList(lastRankData);
        return;
    }

    if (data.type === 'scrollRank') {
        if (!rankViewActive) return;
        var listHeight = Math.max(0, lastRankData.length - 3) * (rankItemBase.height + rankItemBase.gap) - rankItemBase.gap;
        var viewportHeight = selfRankFooterTop - 8 - rankItemBase.top;
        rankScrollOffset = Math.max(0, Math.min(Math.max(0, listHeight - viewportHeight), rankScrollOffset + (Number(data.deltaY) || 0)));
        drawRankList(lastRankData);
        return;
    }

    if (data.type === 'rankData' || data.type === 'winStreak') {
        rankViewActive = true;
        currentKey = data.key || (data.type === 'winStreak' ? 'winsk' : 'level');
        currentTitle = data.title || currentTitle;
        currentScoreLabel = data.scoreLabel || currentScoreLabel;
        currentEmptyText = data.emptyText || currentEmptyText;
        currentFallbackSelf = data.fallbackSelf || null;
        currentSelfRank = null;
        rankScrollOffset = 0;
        syncRankTierConfig(data);
        requestFriendRank(currentKey);
    }
}

if (env && env.onMessage) {
    env.onMessage(handleMessage);
}

clearCanvas();
