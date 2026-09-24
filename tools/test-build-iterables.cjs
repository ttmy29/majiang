/* Creator's loose spread transform treats operands as arrays. Check runtime
 * sources by type, then exercise snapshot validation from source or a Web build.
 * node tools/test-build-iterables.cjs <typescript-path> [web-build-directory]
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2] || 'typescript');
const root = path.resolve(__dirname, '..');
const build = process.argv[3] && path.resolve(process.argv[3]);
const sources = ['assets', 'build-templates'].flatMap(directory =>
    ts.sys.readDirectory(path.join(root, directory), ['.ts', '.js'], ['**/*.d.ts', '**/*.min.js']));
const declarations = ts.sys.readDirectory(path.join(root, 'temp/declarations'), ['.ts']);
const program = ts.createProgram([...sources, ...declarations], {
    target: ts.ScriptTarget.ES2020, allowJs: true, noEmit: true, experimentalDecorators: true,
});
const checker = program.getTypeChecker();
function nodes(tree, predicate) {
    const result = [];
    function visit(node) {
        if (predicate(node)) result.push(node);
        ts.forEachChild(node, visit);
    }
    visit(tree);
    return result;
}
function isArray(type) {
    if (type.isUnion()) return type.types.every(isArray);
    return checker.isArrayType(type) || checker.isTupleType(type);
}
const unsafe = [];
let spreadCount = 0;
for (const file of program.getSourceFiles().filter(file => sources.includes(file.fileName))) {
    for (const spread of nodes(file, ts.isSpreadElement)) {
        spreadCount++;
        const type = checker.getTypeAtLocation(spread.expression);
        if (isArray(type)) continue;
        const line = file.getLineAndCharacterOfPosition(spread.getStart()).line + 1;
        unsafe.push(`${path.relative(root, file.fileName)}:${line} ${spread.getText()} (${checker.typeToString(type)})`);
    }
}
assert.equal(unsafe.length, 0, `Non-array spread needs Array.from before Web compilation:\n${unsafe.join('\n')}`);
console.log(`PASS ${spreadCount} runtime spread operands are arrays (including readonly arrays and tuples)`);

const methodName = 'isSnapshotStateConsistent';
const warnings = [];
const context = vm.createContext({ console: { warn: (...args) => warnings.push(args) } });
let validate;
if (!build) {
    const file = program.getSourceFile(path.join(root, 'assets/game/script/GameCtrl.ts'));
    const method = nodes(file, node => ts.isMethodDeclaration(node) && node.name.getText() === methodName)[0];
    assert.ok(method, 'source snapshot validator exists');
    const compiled = ts.transpileModule(`class Validator { ${method.getText()} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2017 },
    }).outputText;
    validate = vm.runInContext(`${compiled}\nValidator.prototype.${methodName}`, context);
} else {
    // Read the actual generated function and its actual Babel helpers. No source
    // substitution: the old bundle must fail the mismatched-supply regression.
    const registrations = new Map();
    for (const directory of ['src/chunks', 'assets/game']) {
        for (const name of fs.readdirSync(path.join(build, directory)).filter(name => /^(bundle|index).*\.js$/.test(name))) {
            const file = ts.createSourceFile(name, fs.readFileSync(path.join(build, directory, name), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
            for (const call of nodes(file, node => ts.isCallExpression(node)
                && node.expression.getText() === 'System.register' && ts.isStringLiteral(node.arguments[0]))) {
                registrations.set(call.arguments[0].text, call.arguments[2]);
            }
        }
    }
    const helperFactory = registrations.get('chunks:///_virtual/rollupPluginModLoBabelHelpers.js');
    const gameFactory = registrations.get('chunks:///_virtual/GameCtrl.ts');
    assert.ok(helperFactory && gameFactory, 'built GameCtrl and Babel helpers exist');
    const helpers = {};
    vm.runInContext(`(${helperFactory.getText()})`, context)((key, value) => {
        if (typeof key === 'object') Object.assign(helpers, key);
        else helpers[key] = value;
        return typeof key === 'object' ? key : value;
    }).execute();
    for (const assignment of nodes(gameFactory, node => ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)
        && ts.isPropertyAccessExpression(node.right) && Object.hasOwn(helpers, node.right.name.text))) {
        context[assignment.left.text] = helpers[assignment.right.name.text];
    }
    const assignment = nodes(gameFactory, node => ts.isBinaryExpression(node)
        && ts.isPropertyAccessExpression(node.left) && node.left.name.text === methodName
        && ts.isFunctionExpression(node.right))[0];
    assert.ok(assignment, 'built snapshot validator exists');
    validate = vm.runInContext(`(${assignment.right.getText()})`, context);
}

function snapshot() {
    return {
        tiles: Array.from({ length: 6 }, (_, col) => ({ layer: 0, row: 0, col,
            type: col < 3 ? '1' : '2', location: 'board', removed: false })),
        boxes: [{ type: '1', required: 3, progress: 0, unlocked: true, tileKeys: [] }],
        taskQueue: ['2'], slotKeys: [], discardedKeys: [], actionHistoryKeys: [],
    };
}
for (const mode of ['main', 'activity']) {
    const ctrl = { gameMode: mode, nowLevel: 6, currentBoardId: 6,
        targetBoxes: [{}], tiles: snapshot().tiles, tileKey: tile => tile };
    assert.equal(validate.call(ctrl, snapshot()), true, `${mode}: valid supply and demand`);
    const partial = snapshot();
    partial.tiles[0].location = 'target'; partial.tiles[0].removed = true;
    partial.boxes[0].progress = 1; partial.boxes[0].tileKeys = [partial.tiles[0]];
    partial.tiles[1].location = 'slot'; partial.slotKeys = [partial.tiles[1]];
    partial.actionHistoryKeys = [partial.tiles[1]];
    assert.equal(validate.call(ctrl, partial), true, `${mode}: resume collected and stored tiles`);
    for (const [name, change] of [
        ['unbalanced counts', snap => { snap.tiles[0].type = '2'; }],
        ['supply-only type', snap => { snap.tiles[0].type = '3'; }],
        ['demand-only type', snap => { snap.taskQueue.push('3'); }],
        ['missing queued task', snap => { snap.taskQueue = []; }],
    ]) {
        const invalid = snapshot(); change(invalid);
        assert.equal(validate.call(ctrl, invalid), false, `${mode}: reject ${name}`);
    }
}
console.log(`PASS ${build ? 'Web bundle' : 'source'} main/activity snapshots accept valid progress and reject mismatched tile counts`);
