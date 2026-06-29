export type GameMode = 'main' | 'activity';

let currentGameMode: GameMode = 'main';

export function getCurrentGameMode(): GameMode {
    return currentGameMode;
}

export function setCurrentGameMode(mode: GameMode): void {
    currentGameMode = mode;
}
