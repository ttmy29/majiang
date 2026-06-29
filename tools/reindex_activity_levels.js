const fs = require('fs');
const path = require('path');

const dir = 'E:/work/mahjong_match/assets/config_levels_activity';

// 1. Identify files
let files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f.startsWith('pure_level'));

let levels = [];
for (let f of files) {
    let match = f.match(/pure_level(\d+)_config\.json/);
    if (match) {
        levels.push({
            oldId: parseInt(match[1]),
            file: f,
            meta: f + '.meta'
        });
    }
}

// Sort by oldId
levels.sort((a, b) => a.oldId - b.oldId);

// 2. Remove 6, 8, 13
const toRemove = [2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 23, 25, 28, 29, 31, 35, 48, 49, 50, 56, 59];
for (let id of toRemove) {
    let f1 = path.join(dir, `pure_level${id}_config.json`);
    let f2 = path.join(dir, `pure_level${id}_config.json.meta`);
    if (fs.existsSync(f1)) {
        fs.unlinkSync(f1);
        console.log(`Deleted ${f1}`);
    }
    if (fs.existsSync(f2)) {
        fs.unlinkSync(f2);
        console.log(`Deleted ${f2}`);
    }
}

// 3. Re-index
levels = levels.filter(l => !toRemove.includes(l.oldId));

// We need to rename carefully to avoid overwriting files if we are moving 7 to 6, 9 to 7, etc.
// Since we are shifting DOWN (e.g. 7 -> 6, 9 -> 7, 10 -> 8), we can process in ascending order.
// e.g. when processing 7 -> 6, 6 is already deleted.
// when processing 9 -> 7, 7 was already moved to 6, so 7 is free.
// Thus, ascending order is safe.

let newId = 0; // We start at 0 since there is a pure_level0_config.json
for (let i = 0; i < levels.length; i++) {
    // wait, what if we just want to keep the original numbering but shifted?
    // Let's check what the first oldId is.
    // If it's 0, we start newId at 0.
}

// Actually, newId should just increment 1 by 1.
for (let i = 0; i < levels.length; i++) {
    let l = levels[i];
    let expectedId = i; // since it started from 0
    if (l.oldId !== expectedId) {
        let oldJsonPath = path.join(dir, l.file);
        let oldMetaPath = path.join(dir, l.meta);
        let newJsonPath = path.join(dir, `pure_level${expectedId}_config.json`);
        let newMetaPath = path.join(dir, `pure_level${expectedId}_config.json.meta`);

        // Read and update JSON
        let content = JSON.parse(fs.readFileSync(oldJsonPath, 'utf8'));
        content.level_no = expectedId;
        content.level_json = `activity_level_${expectedId}`;
        content.index_config.level_json = `activity_level_${expectedId}`;
        
        fs.writeFileSync(newJsonPath, JSON.stringify(content, null, 2) + '\n', 'utf8');
        
        // Move meta
        if (fs.existsSync(oldMetaPath)) {
            fs.renameSync(oldMetaPath, newMetaPath);
        }
        
        // Delete old JSON
        fs.unlinkSync(oldJsonPath);
        console.log(`Moved ${l.oldId} to ${expectedId}`);
    } else {
        // No rename, but should we ensure internal IDs match?
        // Let's just check just in case.
        let jsonPath = path.join(dir, l.file);
        let content = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        let changed = false;
        if (content.level_no !== expectedId) { content.level_no = expectedId; changed = true; }
        if (content.level_json !== `activity_level_${expectedId}`) { content.level_json = `activity_level_${expectedId}`; changed = true; }
        if (content.index_config.level_json !== `activity_level_${expectedId}`) { content.index_config.level_json = `activity_level_${expectedId}`; changed = true; }
        if (changed) {
            fs.writeFileSync(jsonPath, JSON.stringify(content, null, 2) + '\n', 'utf8');
            console.log(`Updated internals for ${expectedId}`);
        }
    }
}

console.log('Done.');
