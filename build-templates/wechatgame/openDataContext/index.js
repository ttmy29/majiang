var env = (typeof GameGlobal !== 'undefined' && (GameGlobal.wx || GameGlobal.tt || GameGlobal.swan)) || (typeof wx !== 'undefined' ? wx : null);
var sharedCanvas = env && env.getSharedCanvas ? env.getSharedCanvas() : null;
var ctx = sharedCanvas ? sharedCanvas.getContext('2d') : null;

var currentKey = 'level';
var currentTitle = '好友排行';
var currentScoreLabel = '通过关卡';
var currentEmptyText = '暂无好友排行';
var currentFallbackSelf = null;
var imageCache = {};
var rankBgPaths = {
    self: ['openDataContext/bg1.png'],
    other: ['openDataContext/bg2.png'],
};
var rankMedalPaths = ['openDataContext/1.png', 'openDataContext/2.png', 'openDataContext/3.png'];
var headBgPath = 'openDataContext/headBg.png';
var defaultHeadPath = 'openDataContext/defaultHead.png';
var rankItemBase = {
    width: 576,
    height: 80.064,
    gap: 8,
    top: 12,
    rankX: 62.58,
    avatarX: 168.83,
    nameX: 293.5,
    scoreX: 490.77,
    medalWidth: 100.48,
    medalHeight: 65.92,
    avatarSize: 64.64,
    rankFontSize: 35,
    textFontSize: 23,
};

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

function drawImageCoverRounded(image, x, y, width, height, radius) {
    try {
        ctx.save();
        traceRoundRect(x, y, width, height, radius);
        ctx.clip();
        var ok = drawImageCover(image, x, y, width, height);
        ctx.restore();
        return ok;
    } catch (e) {
        try {
            ctx.restore();
        } catch (restoreError) {}
        return false;
    }
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

    var inset = Math.max(4, size * 0.12);
    var innerX = x + inset;
    var innerY = y + inset;
    var innerSize = Math.max(0, size - inset * 2);
    var innerRadius = Math.max(6, innerSize * 0.16);

    var cached = imageCache[url];
    if (cached && cached._rankLoaded) {
        drawImageCoverRounded(cached, innerX, innerY, innerSize, innerSize, innerRadius);
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

function drawRankList(data) {
    if (!ctx || !sharedCanvas) return;
    lastRankData = data || [];
    clearCanvas();

    if (!lastRankData.length) {
        drawEmpty();
        return;
    }

    var width = sharedCanvas.width;
    var horizontalPadding = Math.max(32, width * 0.05);
    var rowWidth = Math.max(0, width - horizontalPadding * 2);
    var rowScale = rowWidth / rankItemBase.width;
    var rowHeight = rankItemBase.height * rowScale;
    var rowGap = rankItemBase.gap * rowScale;
    var startY = rankItemBase.top * rowScale;
    var rowX = (width - rowWidth) / 2;
    var avatarSize = rankItemBase.avatarSize * rowScale;
    var medalWidth = rankItemBase.medalWidth * rowScale;
    var medalHeight = rankItemBase.medalHeight * rowScale;
    var rankFontSize = rankItemBase.rankFontSize * rowScale;
    var textFontSize = rankItemBase.textFontSize * rowScale;

    for (var i = 0; i < lastRankData.length; i++) {
        var item = lastRankData[i];
        var y = startY + i * (rowHeight + rowGap);
        var centerY = y + rowHeight / 2;
        var rankX = rowX + rankItemBase.rankX * rowScale;
        var avatarX = rowX + rankItemBase.avatarX * rowScale - avatarSize / 2;
        var nameX = rowX + rankItemBase.nameX * rowScale;
        var scoreX = rowX + rankItemBase.scoreX * rowScale;
        drawRankBackground(isSelfRankItem(item), rowX, y, rowWidth, rowHeight);

        var rankColor = i < 3 ? '#ffffff' : '#9b4e27';
        var medalColor = i === 0 ? '#ffb52e' : (i === 1 ? '#a9d3e8' : (i === 2 ? '#e27f3d' : ''));
        if (i < 3) {
            if (!drawImageFit(rankMedalPaths[i], rankX - medalWidth / 2, centerY - medalHeight / 2, medalWidth, medalHeight)) {
                drawRoundRect(rankX - 27 * rowScale, centerY - 24 * rowScale, 54 * rowScale, 48 * rowScale, 14 * rowScale, medalColor);
                drawText(String(i + 1), rankX, centerY + rowScale, rankFontSize, rankColor, 'center', true);
            }
        } else {
            drawText(String(i + 1), rankX, centerY + rowScale, rankFontSize, rankColor, 'center', true);
        }

        drawAvatar(item.avatarUrl, avatarX, centerY - avatarSize / 2, avatarSize, item.nickname);
        drawText(clipText(item.nickname, 8), nameX, centerY, textFontSize, '#8d3f25', 'center', true);
        drawText(String(item.rankScore), scoreX, centerY, textFontSize, '#8d3f25', 'center', true);
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
        requestFriendRank(currentKey);
    }
}

if (env && env.onMessage) {
    env.onMessage(handleMessage);
}

clearCanvas();
