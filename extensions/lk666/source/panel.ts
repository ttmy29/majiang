import { PACKAGE_NAME } from './global';
import { DEFAULT_CONFIG, ObfuscationConfig, normalizeConfig } from './config';

let currentConfig = normalizeConfig(DEFAULT_CONFIG);

type PanelThis = {
    $: {
        enabled: HTMLInputElement;
        preset: HTMLSelectElement;
        include: HTMLInputElement;
        exclude: HTMLInputElement;
        verbose: HTMLInputElement;
        save: HTMLElement;
        status: HTMLElement;
    };
};

export const style = `
.lk-obfuscation-panel {
    box-sizing: border-box;
    height: 100%;
    padding: 18px;
    overflow: auto;
    color: var(--color-normal-contrast);
    background: var(--color-normal-fill);
    font-size: 13px;
    line-height: 1.6;
}

.lk-obfuscation-panel h2 {
    margin: 0 0 14px;
    font-size: 18px;
    font-weight: 600;
}

.lk-field {
    margin-bottom: 12px;
}

.lk-field label {
    display: block;
    margin-bottom: 5px;
    color: var(--color-normal-contrast-important);
}

.lk-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.lk-field input[type="text"],
.lk-field select {
    box-sizing: border-box;
    width: 100%;
    height: 26px;
}

.lk-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
    padding-bottom: 4px;
}

.lk-status {
    color: var(--color-success-fill);
}

.lk-help {
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--color-normal-border);
}

.lk-help-title {
    margin-bottom: 8px;
    font-weight: 600;
    color: var(--color-normal-contrast-important);
}

.lk-help ul {
    margin: 0;
    padding-left: 18px;
}

.lk-help li {
    margin-bottom: 6px;
}
`;

export const template = `
<div class="lk-obfuscation-panel">
    <h2>&#20195;&#30721;&#28151;&#28102;</h2>

    <div class="lk-field lk-row">
        <input id="enabled" type="checkbox">
        <label for="enabled">&#26500;&#24314;&#23436;&#25104;&#21518;&#21551;&#29992;&#28151;&#28102;</label>
    </div>

    <div class="lk-field">
        <label for="preset">&#28151;&#28102;&#39044;&#35774;</label>
        <select id="preset">
            <option value="lower">&#26497;&#20302;</option>
            <option value="low">&#20302;</option>
            <option value="mid">&#20013;</option>
            <option value="high">&#39640;</option>
            <option value="default">&#40664;&#35748;</option>
            <option value="off">&#20851;&#38381;</option>
        </select>
    </div>

    <div class="lk-field">
        <label for="include">&#21253;&#21547;&#36335;&#24452;</label>
        <input id="include" type="text">
    </div>

    <div class="lk-field">
        <label for="exclude">&#25490;&#38500;&#36335;&#24452;</label>
        <input id="exclude" type="text">
    </div>

    <div class="lk-field lk-row">
        <input id="verbose" type="checkbox">
        <label for="verbose">&#22312;&#26500;&#24314;&#26085;&#24535;&#20013;&#25171;&#21360;&#22788;&#29702;&#30340;&#25991;&#20214;</label>
    </div>

    <div class="lk-actions">
        <ui-button id="save">&#20445;&#23384;</ui-button>
        <span id="status" class="lk-status"></span>
    </div>

    <div class="lk-help">
        <div class="lk-help-title">&#28151;&#28102;&#39044;&#35774;&#35828;&#26126;</div>
        <ul>
            <li>&#26497;&#20302; lower&#65306;&#36731;&#24230;&#28151;&#28102;&#65292;&#24615;&#33021;&#24433;&#21709;&#26368;&#23567;&#12290;&#24403;&#21069;&#40664;&#35748;&#20540;&#12290;&#20027;&#35201;&#25913;&#21464;&#37327;&#21517;&#12289;&#23383;&#31526;&#20018;&#35775;&#38382;&#26041;&#24335;&#12290;</li>
            <li>&#20302; low&#65306;&#27604;&#26497;&#20302;&#26356;&#26126;&#26174;&#65292;&#20250;&#20851;&#25481; console &#36755;&#20986;&#65292;&#23383;&#31526;&#20018;&#25968;&#32452;&#22788;&#29702;&#26356;&#22810;&#19968;&#28857;&#12290;</li>
            <li>&#20013; mid&#65306;&#24320;&#21551;&#25511;&#21046;&#27969;&#25153;&#24179;&#21270;&#12289;&#27515;&#20195;&#30721;&#27880;&#20837;&#12289;&#23383;&#31526;&#20018;&#32534;&#30721;&#31561;&#65292;&#20195;&#30721;&#26356;&#38590;&#35835;&#65292;&#20294;&#20307;&#31215;&#21644;&#24615;&#33021;&#25439;&#32791;&#20250;&#26126;&#26174;&#22686;&#21152;&#12290;</li>
            <li>&#39640; high&#65306;&#26368;&#24378;&#28151;&#28102;&#65292;&#24615;&#33021;&#25439;&#32791;&#26368;&#22823;&#65292;&#20063;&#26368;&#23481;&#26131;&#24341;&#21457;&#20860;&#23481;&#38382;&#39064;&#12290;&#23567;&#28216;&#25103;&#24179;&#21488;&#19978;&#35201;&#35880;&#24910;&#12290;</li>
            <li>&#40664;&#35748; default&#65306;&#25509;&#36817;&#21407;&#25554;&#20214;&#40664;&#35748;&#37197;&#32622;&#65292;&#20013;&#31561;&#20559;&#36731;&#12290;</li>
            <li>&#20851;&#38381; off&#65306;&#22522;&#26412;&#19981;&#20570;&#26377;&#25928;&#28151;&#28102;&#65292;&#36890;&#24120;&#21482;&#29992;&#20110;&#20020;&#26102;&#39564;&#35777;&#27969;&#31243;&#12290;</li>
        </ul>
    </div>
</div>
`;

export const $ = {
    enabled: '#enabled',
    preset: '#preset',
    include: '#include',
    exclude: '#exclude',
    verbose: '#verbose',
    save: '#save',
    status: '#status',
};

export async function ready(this: PanelThis) {
    currentConfig = normalizeConfig(await Editor.Message.request(PACKAGE_NAME, 'get-config'));
    render(this);
    this.$.enabled.addEventListener('change', () => updateConfig(this));
    this.$.preset.addEventListener('change', () => updateConfig(this));
    this.$.include.addEventListener('input', () => updateConfig(this));
    this.$.exclude.addEventListener('input', () => updateConfig(this));
    this.$.verbose.addEventListener('change', () => updateConfig(this));
    this.$.save.addEventListener('confirm', () => save(this));
    this.$.save.addEventListener('click', () => save(this));
}

function render(panel: PanelThis) {
    panel.$.enabled.checked = currentConfig.enabled;
    panel.$.preset.value = currentConfig.preset;
    panel.$.include.value = currentConfig.include;
    panel.$.exclude.value = currentConfig.exclude;
    panel.$.verbose.checked = currentConfig.verbose;
    panel.$.status.textContent = '';
}

function updateConfig(panel: PanelThis) {
    currentConfig = normalizeConfig({
        enabled: panel.$.enabled.checked,
        preset: panel.$.preset.value as ObfuscationConfig['preset'],
        include: panel.$.include.value,
        exclude: panel.$.exclude.value,
        verbose: panel.$.verbose.checked,
    });
    panel.$.status.textContent = '\u672a\u4fdd\u5b58';
}

async function save(panel: PanelThis) {
    updateConfig(panel);
    currentConfig = normalizeConfig(await Editor.Message.request(PACKAGE_NAME, 'save-config', currentConfig));
    render(panel);
    panel.$.status.textContent = '\u5df2\u4fdd\u5b58';
}
