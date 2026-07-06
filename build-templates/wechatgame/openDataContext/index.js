var env = (typeof GameGlobal !== 'undefined' && (GameGlobal.wx || GameGlobal.tt || GameGlobal.swan)) || (typeof wx !== 'undefined' ? wx : null);
var sharedCanvas = env && env.getSharedCanvas ? env.getSharedCanvas() : null;
var ctx = sharedCanvas ? sharedCanvas.getContext('2d') : null;

var currentKey = 'level';
var currentTitle = '好友排行';
var currentScoreLabel = '通过关卡';
var currentEmptyText = '暂无好友排行';
var imageCache = {};

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

function drawRoundRect(x, y, width, height, radius, color) {
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
    ctx.fillStyle = color;
    ctx.fill();
}

function drawText(text, x, y, size, color, align, bold) {
    ctx.fillStyle = color;
    ctx.font = (bold ? 'bold ' : '') + size + 'px Arial';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
}

function clipText(text, maxChars) {
    text = text || '好友';
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 1) + '…';
}

function drawAvatar(url, x, y, size) {
    drawRoundRect(x, y, size, size, 10, '#f2d29b');
    drawText('?', x + size / 2, y + size / 2 + 1, 30, '#8f4b25', 'center', true);

    if (!url || !env) return;
    var cached = imageCache[url];
    if (cached && cached.complete) {
        try {
            ctx.drawImage(cached, x, y, size, size);
        } catch (e) {}
        return;
    }

    if (cached) return;
    var image = env.createImage ? env.createImage() : null;
    if (!image) return;
    image.onload = function() {
        image.complete = true;
        drawRankList(lastRankData);
    };
    image.onerror = function() {
        image.failed = true;
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
    var rowHeight = Math.min(78, Math.floor((sharedCanvas.height - 22) / 10));
    var rowGap = 6;
    var startY = 12;
    var rowWidth = Math.min(860, width - 80);
    var rowX = (width - rowWidth) / 2;
    var avatarSize = Math.max(46, Math.min(58, rowHeight - 20));

    for (var i = 0; i < lastRankData.length; i++) {
        var item = lastRankData[i];
        var y = startY + i * (rowHeight + rowGap);
        var centerY = y + rowHeight / 2;
        var bgColor = i % 2 === 0 ? '#f4d8aa' : '#efd09a';
        drawRoundRect(rowX, y, rowWidth, rowHeight, 10, bgColor);

        var rankColor = i < 3 ? '#ffffff' : '#9b4e27';
        var medalColor = i === 0 ? '#ffb52e' : (i === 1 ? '#a9d3e8' : (i === 2 ? '#e27f3d' : ''));
        if (i < 3) {
            drawRoundRect(rowX + 34, centerY - 24, 54, 48, 14, medalColor);
        }
        drawText(String(i + 1), rowX + 61, centerY + 1, i < 3 ? 30 : 28, rankColor, 'center', true);

        drawAvatar(item.avatarUrl, rowX + 142, centerY - avatarSize / 2, avatarSize);
        drawText(clipText(item.nickname, 8), rowX + 230, centerY, 28, '#8d3f25', 'left', true);
        drawText(String(item.rankScore), rowX + rowWidth - 96, centerY, 30, '#8d3f25', 'center', true);
    }
}

function requestFriendRank(key) {
    if (!env || !env.getFriendCloudStorage) {
        drawEmpty();
        return;
    }

    env.getFriendCloudStorage({
        keyList: [key],
        success: function(res) {
            drawRankList(normalizeRankData(res && res.data, key));
        },
        fail: function() {
            drawEmpty();
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
        requestFriendRank(currentKey);
    }
}

if (env && env.onMessage) {
    env.onMessage(handleMessage);
}

clearCanvas();
