import './shim';

export const CROW_PREVIEW_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABbUlEQVR4nO2VzU6DQBSFTxsTiRKUv9CfGJI2aXwB48P4Wr6N8QV06aZpggkxUMlQUIKmbhxXg0xL22EguuFbwTDcc++5cwHo6Ojo+Gd6bQRRVIPaoyk03QYAZCnBy+JRKHa/qfjF7IqW7+9uh0VSIu8fyQorqkHXecJVmaUE1zeE21N+vrlfKgEW1B5NQUIUAiT0uH1VYlUIbWI93kTTbWQp4dZEe8+o7YCm27CcMbeWpWTLAVFqH8KlP69MqsqhVhIo2/+RrQAAcRTg6eEecRRwScggNQWWMy7aEEcBlv4cp5oplcDBA8NO/Yl6DgAYupfcc9YSlgAJPeEJAARawILtq1C2ekDAAWMwoZ/5G4BfF3YlwCahNQeMwYSzf1+lMuLADgeYMKt8nSe98mfVMS18H58BAPpf74hWsZQ4UDEFimrQ5PV5KxAX3LQoCT1u9mXEpXHdGa26lqHx77gptWw7VK3vL/6uDR0dbfED34mHkrnn5lQAAAAASUVORK5CYII=';

const CROW_SIZE = 64;
const CROW_HALF = CROW_SIZE / 2;
const CROW_EDGE = 38;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Stable crow NPC.
 *
 * The generated 8x8 crow atlas contained inconsistent silhouettes, especially
 * the fly row. The NPC therefore uses the one known-good native 32x32 frame at
 * an exact 2x scale and animates only world position. The image itself never
 * changes while flying, so a tap cannot produce a corrupted sprite.
 */
export function mountCrowNPC(layer: HTMLElement) {
    const crow = layer.createEl('button', {
        cls: 'garden-pet garden-pet-crow',
        attr: {
            type: 'button',
            'aria-label': 'Crow. Tap to make it fly.',
        },
    });
    const sprite = crow.createDiv('garden-pet-crow-sprite');
    sprite.style.backgroundImage = 'url("' + CROW_PREVIEW_URL + '")';

    const world = layer.parentElement ?? layer;
    const worldWidth = () => Math.max(520, layer.clientWidth || world.clientWidth || 520);
    const sky = () => Number.parseFloat(getComputedStyle(world).getPropertyValue('--sky')) || 620;
    const groundY = () => sky() - 26;

    let x = clamp(worldWidth() * 0.72, CROW_EDGE, worldWidth() - CROW_EDGE);
    let y = groundY();
    let direction = -1;
    let flying = false;
    let raf: number | null = null;
    let idleTimer: number | null = null;
    let press: { x: number; y: number } | null = null;

    const place = (nextX: number, nextY: number) => {
        x = Math.round(nextX);
        y = Math.round(nextY);
        crow.style.transform =
            'translate3d(' + (x - CROW_HALF) + 'px,' + (y - CROW_HALF) + 'px,0)';
    };

    const face = (next: number) => {
        direction = next >= 0 ? 1 : -1;
        sprite.toggleClass('is-flipped', direction < 0);
    };

    const cancelMove = () => {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
    };

    const scheduleGroundLife = () => {
        if (idleTimer !== null) window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
            if (!crow.isConnected || flying) return;

            const width = worldWidth();
            const distance = 34 + Math.random() * 82;
            const target = clamp(
                x + (Math.random() < 0.5 ? -distance : distance),
                CROW_EDGE,
                width - CROW_EDGE,
            );
            face(target - x);

            const startX = x;
            const start = performance.now();
            const duration = 900 + Math.random() * 550;

            const step = (now: number) => {
                if (!crow.isConnected || flying) return;
                const t = clamp((now - start) / duration, 0, 1);
                const bob = Math.sin(Math.PI * t) * 7;
                place(startX + (target - startX) * t, groundY() - bob);

                if (t >= 1) {
                    raf = null;
                    place(target, groundY());
                    scheduleGroundLife();
                    return;
                }
                raf = requestAnimationFrame(step);
            };
            raf = requestAnimationFrame(step);
        }, 2600 + Math.random() * 3500);
    };

    const fly = () => {
        if (flying) {
            face(-direction);
            return;
        }

        flying = true;
        cancelMove();
        if (idleTimer !== null) window.clearTimeout(idleTimer);

        const width = worldWidth();
        const startX = x;
        const startY = y;
        const targetX = x > width / 2 ? CROW_EDGE + 28 : width - CROW_EDGE - 28;
        const targetY = Math.max(100, sky() * 0.42);
        face(targetX - startX);

        const start = performance.now();
        const duration = 2600;

        const step = (now: number) => {
            if (!crow.isConnected) return;
            const t = clamp((now - start) / duration, 0, 1);
            const eased = t < 0.5
                ? 2 * t * t
                : 1 - Math.pow(-2 * t + 2, 2) / 2;
            const arc = Math.sin(Math.PI * t) * 70;

            place(
                startX + (targetX - startX) * eased,
                startY + (targetY - startY) * eased - arc,
            );

            if (t >= 1) {
                raf = null;
                flying = false;
                const landX = clamp(targetX, CROW_EDGE, width - CROW_EDGE);
                place(landX, groundY());
                scheduleGroundLife();
                return;
            }
            raf = requestAnimationFrame(step);
        };

        raf = requestAnimationFrame(step);
    };

    crow.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    crow.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    crow.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });

    crow.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        press = { x: e.clientX, y: e.clientY };
        crow.setPointerCapture?.(e.pointerId);
    });
    crow.addEventListener('pointerup', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const start = press;
        press = null;
        if (!start) return;
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 12) fly();
    });
    crow.addEventListener('pointercancel', () => { press = null; });
    crow.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    crow.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        fly();
    });

    face(direction);
    place(x, y);
    scheduleGroundLife();

    return { fly };
}
