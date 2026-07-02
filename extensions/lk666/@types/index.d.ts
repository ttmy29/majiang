export * from '@cocos/creator-types/editor/packages/builder/@types/public';

import { IBuildTaskOption } from '@cocos/creator-types/editor/packages/builder/@types/public';

export interface IOptions {
    enabled: boolean;
    preset: 'off' | 'default' | 'high' | 'mid' | 'low' | 'lower';
    include: string;
    exclude: string;
    verbose: boolean;
}

export interface ITaskOptions extends IBuildTaskOption {
    packages: {
        lk666: IOptions;
    };
}
