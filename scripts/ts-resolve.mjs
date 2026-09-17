// Lets "node --test" run the core's TypeScript as it is written.
//
// Node 24 strips types by itself, but it still resolves imports the way the web
// does not: the core says `import './model'`, because Vite fills the extension
// in. This hook does the same for Node, so the source stays bundler-idiomatic
// and the tests import the real modules rather than copies.
//
// Used by "npm run test:unit": node --import ./scripts/ts-resolve.mjs --test ...

import { registerHooks } from 'node:module';

registerHooks({
    resolve(specifier, context, nextResolve) {
        const relative = specifier.startsWith('./') || specifier.startsWith('../');
        const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
        if (relative && !hasExtension) {
            try {
                return nextResolve(specifier + '.ts', context);
            } catch {
                // Not a .ts file after all; fall through to the normal rules.
            }
        }
        return nextResolve(specifier, context);
    },
});
