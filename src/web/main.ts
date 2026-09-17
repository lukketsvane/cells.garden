import '../core/shim';
import './app.css';
import '../core/ui.css';
import '../core/styles.css';

import type { GardenApp } from '../core/app';
import { bootGarden } from '../core/boot';

const host = document.getElementById('app');
if (!host) throw new Error('cells.garden: #app element missing');

// Handy in the console while developing.
declare global {
    interface Window { garden: GardenApp | undefined }
}

bootGarden(host).then((app) => {
    window.garden = app;
});
