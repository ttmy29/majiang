export type GameMode = 'main' | 'activity';
export type ActivitySignMode = 'daily' | 'makeup';

let currentGameMode: GameMode = 'main';
let currentActivitySignMode: ActivitySignMode = 'daily';

export function getCurrentGameMode(): GameMode {
    return currentGameMode;
}

export function setCurrentGameMode(mode: GameMode): void {
    currentGameMode = mode;
}

export function getCurrentActivitySignMode(): ActivitySignMode {
    return currentActivitySignMode;
}

export function setCurrentActivitySignMode(mode: ActivitySignMode): void {
    currentActivitySignMode = mode;
}
