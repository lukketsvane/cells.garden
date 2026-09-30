// Kept outside the HTTP process so long product checks do not block progress updates.
import { executeDelivery } from './design-delivery.mjs';
const result = await executeDelivery(process.argv[2], { target: 'dev', commit: process.argv[3], mode: 'publish' });
console.log(`ARTWORK_RESULT ${JSON.stringify(result)}`);
