/**
 * The scenery behind the garden. Forest has the tree line in front of the
 * mountains; Mountains leaves it out, so the ridges and clouds stand open.
 * The choice stays on this device, like the camera, and never enters the
 * synced garden.
 */
export type Scene = 'forest' | 'mountains';

const KEY = 'cells.garden/scene';

export function currentScene(): Scene {
    try {
        return localStorage.getItem(KEY) === 'mountains' ? 'mountains' : 'forest';
    } catch {
        return 'forest';
    }
}

export function applyScene(scene: Scene = currentScene()) {
    document.documentElement.dataset.scene = scene;
}

export function setScene(scene: Scene) {
    try {
        localStorage.setItem(KEY, scene);
    } catch {
        // Blocked storage: the scene still changes for this visit.
    }
    applyScene(scene);
}

