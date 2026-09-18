/**
 * The scenery behind the garden. Forest has the tree line in front of the
 * mountains; Mountains leaves it out, so the ridges and clouds stand open.
 * The choice stays on this device, like the camera, and never enters the
 * synced garden.
 */
export type Scene = 'forest' | 'mountains';

import { local } from './local';

const KEY = 'cells.garden/scene';

export function currentScene(): Scene {
    return local.get(KEY) === 'mountains' ? 'mountains' : 'forest';
}

export function applyScene(scene: Scene = currentScene()) {
    document.documentElement.dataset.scene = scene;
}

export function setScene(scene: Scene) {
    local.set(KEY, scene); // Blocked storage: the scene still changes for this visit.
    applyScene(scene);
}

