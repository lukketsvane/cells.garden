import './shim';

/**
 * Crow atlas: 160 x 160 PNG, 8 x 8 cells, each frame 20 x 20 native pixels.
 *
 * Rows in order: idle/look, walk/hop, run/brake, peck/eat, takeoff, landing,
 * flight flap, glide/descend, eight frames each. The scene only drives the
 * ground rows today; the rest are described here so the sheet's layout lives
 * in one place.
 */
export const CROW_ATLAS_URL =
    'data:image/png;base64,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';

export const CROW_PREVIEW_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAA9ElEQVR42u2WPQ/BUBSGn4pBaMRnEIPEZDD4IwZ/1trZZpFY2AjxGUFsNcgZekOqLYlc59maprfNk/c9p6AoiqIoiqL8M863Ds64JR8g6xYA2K/msd6V+juDpXrbB7iejwDMvUHgfrfvBa7DzNpvULImSOZy+TIA+WIVgNNhA8DltIuUSXsNStaERqsDQKXWfGRvOgZgs5wFnrud945VLU4nNSdZM2l3eoEMTkZDO+dgOukB0koxZSLtjYv9Bk2268XTuWetwdBmmZvC3BhhyE6OOv/s2yRi8pUJ03RcY/o3Y5LU5M8b/NgHZt3C2822yqCSlDv3jkggei1DmQAAAABJRU5ErkJggg==';

type CrowAnimation =
    | 'idle'
    | 'walk'
    | 'run'
    | 'peck'
    | 'takeoff'
    | 'landing'
    | 'flight'
    | 'glide';
type CrowMode = 'grounded' | 'walking' | 'hopping';

const CROW_ANIMS: Record<CrowAnimation, { row: number; frames: number; duration: number }> = {
    idle: { row: 0, frames: 8, duration: 220 },
    walk: { row: 1, frames: 8, duration: 110 },
    run: { row: 2, frames: 8, duration: 70 },
    peck: { row: 3, frames: 8, duration: 150 },
    takeoff: { row: 4, frames: 8, duration: 90 },
    landing: { row: 5, frames: 8, duration: 90 },
    flight: { row: 6, frames: 8, duration: 80 },
    glide: { row: 7, frames: 8, duration: 140 },
};

const CROW_COLUMNS = 8;
const CROW_ROWS = 8;
/** 2x the native 20 px frame. The scene reads as pixel art at this size. */
const CROW_SIZE = 40;
const CROW_HALF = CROW_SIZE / 2;
/** Clear of the world edge by half a crow plus a little air. */
const CROW_EDGE = CROW_HALF + 10;
/** The crow's feet sit 18 of 20 rows down the frame, so this drops them on the soil. */
const CROW_FOOT = 16;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function mountCrowNPC(layer: HTMLElement) {
    const crow = layer.createEl('button', {
        cls: 'garden-pet garden-pet-crow',
        attr: {
            type: 'button',
            'aria-label': 'Crow. Tap to make it walk. Hold to make it hop.',
        },
    });
    crow.style.setProperty('--crow-atlas', 'url("' + CROW_ATLAS_URL + '")');
    // Keep sprite scale self-contained so stale CSS can never shrink or mis-crop it.
    crow.style.width = CROW_SIZE + 'px';
    crow.style.height = CROW_SIZE + 'px';
    crow.style.backgroundSize =
        (CROW_SIZE * CROW_COLUMNS) + 'px ' + (CROW_SIZE * CROW_ROWS) + 'px';
    crow.style.backgroundRepeat = 'no-repeat';
    crow.style.imageRendering = 'pixelated';

    const world = layer.parentElement ?? layer;
    const viewport = world.parentElement;
    const worldWidth = () => Math.max(600, layer.clientWidth || world.clientWidth || 600);
    const sky = () => Number.parseFloat(getComputedStyle(world).getPropertyValue('--sky')) || 620;
    const groundY = () => sky() - CROW_FOOT;

    /**
     * Where the crow is allowed to wander, in world pixels.
     *
     * The world is far wider than the slice of it the camera shows, so roaming
     * the full width walked the crow off screen for minutes at a time. These
     * bounds are the visible slice, measured back through the camera's own
     * transform, so the crow keeps to the garden being looked at.
     */
    const roamBounds = () => {
        const width = worldWidth();
        const fallback = { min: CROW_EDGE, max: Math.max(CROW_EDGE, width - CROW_EDGE) };
        if (!viewport) return fallback;

        const worldRect = world.getBoundingClientRect();
        const viewRect = viewport.getBoundingClientRect();
        const scale = worldRect.width / (world.offsetWidth || width);
        if (!(scale > 0) || !(viewRect.width > 0)) return fallback;

        const min = Math.max(fallback.min, (viewRect.left - worldRect.left) / scale + CROW_EDGE);
        const max = Math.min(fallback.max, (viewRect.right - worldRect.left) / scale - CROW_EDGE);
        return max > min ? { min, max } : fallback;
    };

    const intoBounds = (value: number) => {
        const { min, max } = roamBounds();
        return clamp(value, min, max);
    };

    let mode: CrowMode = 'grounded';
    let animation: CrowAnimation = 'idle';
    let frame = 0;
    let direction = 1;
    // The world's middle is the middle plant, so this starts the crow beside the
    // garden rather than out in the padding where the camera never looks.
    let x = clamp(worldWidth() / 2 + 70, CROW_EDGE, worldWidth() - CROW_EDGE);
    let y = groundY();

    let animationTimer: number | null = null;
    let animationToken = 0;
    let movementRAF: number | null = null;
    let movementToken = 0;
    let idleTimer: number | null = null;
    let holdTimer: number | null = null;
    let press: { x: number; y: number; at: number } | null = null;
    let held = false;

    const connected = () => crow.isConnected;

    const place = (nextX: number, nextY: number) => {
        x = Math.round(nextX);
        y = Math.round(nextY);
        crow.style.transform =
            'translate3d(' + (x - CROW_HALF) + 'px,' + (y - CROW_HALF) + 'px,0)';
    };

    const face = (nextDirection: number) => {
        direction = nextDirection >= 0 ? 1 : -1;
        crow.toggleClass('is-flipped', direction < 0);
    };

    const draw = () => {
        const spec = CROW_ANIMS[animation];
        crow.style.backgroundPosition =
            (-frame * CROW_SIZE) + 'px ' + (-spec.row * CROW_SIZE) + 'px';
        crow.dataset.state = mode;
    };

    const stopAnimation = () => {
        animationToken++;
        if (animationTimer !== null) window.clearTimeout(animationTimer);
        animationTimer = null;
    };

    const play = (name: CrowAnimation) => {
        stopAnimation();
        animation = name;
        frame = 0;
        draw();

        const token = animationToken;
        const spec = CROW_ANIMS[name];

        const step = () => {
            if (!connected() || token !== animationToken) return;
            frame = (frame + 1) % spec.frames;
            draw();
            animationTimer = window.setTimeout(step, spec.duration);
        };

        animationTimer = window.setTimeout(step, spec.duration);
    };

    const stopMovement = () => {
        movementToken++;
        if (movementRAF !== null) cancelAnimationFrame(movementRAF);
        movementRAF = null;
    };

    const clearGroundTimer = () => {
        if (idleTimer !== null) window.clearTimeout(idleTimer);
        idleTimer = null;
    };

    const scheduleGroundLife = () => {
        clearGroundTimer();
        idleTimer = window.setTimeout(() => {
            if (!connected() || mode !== 'grounded') return;
            if (Math.random() < 0.72) walk();
            else hop();
        }, 2200 + Math.random() * 3400);
    };

    const becomeIdle = () => {
        stopMovement();
        mode = 'grounded';
        place(intoBounds(x), groundY());
        play('idle');
        scheduleGroundLife();
    };

    const walk = (preferredDirection?: number) => {
        if (mode !== 'grounded') return;
        clearGroundTimer();
        mode = 'walking';

        const { min, max } = roamBounds();
        const stride = 28 + Math.random() * 48;
        const sign = preferredDirection
            ? (preferredDirection >= 0 ? 1 : -1)
            : (Math.random() < 0.5 ? -1 : 1);

        let target = clamp(x + sign * stride, min, max);
        if (Math.abs(target - x) < 12) {
            target = clamp(x + (x < (min + max) / 2 ? 1 : -1) * 30, min, max);
        }

        face(target >= x ? 1 : -1);
        play('walk');

        const token = ++movementToken;
        let previous = performance.now();

        const step = (now: number) => {
            if (!connected() || mode !== 'walking' || token !== movementToken) return;
            const dt = Math.min(40, now - previous);
            previous = now;

            const dx = target - x;
            const move = Math.min(Math.abs(dx), 0.028 * dt);
            place(x + Math.sign(dx || direction) * move, groundY());

            if (Math.abs(target - x) <= 1) {
                movementRAF = null;
                becomeIdle();
                return;
            }

            movementRAF = requestAnimationFrame(step);
        };

        movementRAF = requestAnimationFrame(step);
    };

    /** A hop is the walk cycle carried along an arc, so it has no frame of its own to go missing. */
    const hop = () => {
        if (mode !== 'grounded') return;
        clearGroundTimer();
        mode = 'hopping';

        const { min, max } = roamBounds();
        const distance = 12 + Math.random() * 16;
        const target = clamp(x + (Math.random() < 0.5 ? -distance : distance), min, max);
        face(target >= x ? 1 : -1);

        const startX = x;
        const startY = groundY();
        const start = performance.now();
        const duration = CROW_ANIMS.walk.frames * CROW_ANIMS.walk.duration;
        const token = ++movementToken;

        play('walk');

        const step = (now: number) => {
            if (!connected() || mode !== 'hopping' || token !== movementToken) return;
            const t = clamp((now - start) / duration, 0, 1);
            const arc = Math.sin(Math.PI * t) * 8;

            place(startX + (target - startX) * t, startY - arc);

            if (t >= 1) {
                movementRAF = null;
                becomeIdle();
                return;
            }

            movementRAF = requestAnimationFrame(step);
        };

        movementRAF = requestAnimationFrame(step);
    };

    const stopSceneGesture = (e: Event) => e.stopPropagation();
    crow.addEventListener('touchstart', stopSceneGesture, { passive: true });
    crow.addEventListener('touchmove', stopSceneGesture, { passive: true });
    crow.addEventListener('touchend', stopSceneGesture, { passive: true });
    crow.addEventListener('mousedown', stopSceneGesture);

    crow.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    crow.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        crow.setPointerCapture?.(e.pointerId);

        press = { x: e.clientX, y: e.clientY, at: performance.now() };
        held = false;

        if (holdTimer !== null) window.clearTimeout(holdTimer);
        holdTimer = window.setTimeout(() => {
            if (!press || !connected()) return;
            held = true;
            hop();
        }, 520);
    });

    crow.addEventListener('pointermove', (e) => {
        if (!press || holdTimer === null) return;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
            window.clearTimeout(holdTimer);
            holdTimer = null;
        }
    });

    crow.addEventListener('pointerup', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (holdTimer !== null) window.clearTimeout(holdTimer);
        holdTimer = null;

        const started = press;
        press = null;
        if (!started || held) return;

        if (
            Math.hypot(e.clientX - started.x, e.clientY - started.y) < 10 &&
            performance.now() - started.at < 520
        ) {
            walk(direction);
        }
    });

    crow.addEventListener('pointercancel', () => {
        if (holdTimer !== null) window.clearTimeout(holdTimer);
        holdTimer = null;
        press = null;
    });

    crow.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        walk(direction);
    });

    place(x, y);
    play('idle');
    // The camera transform is applied after this layer is built, so the first
    // reading of the visible slice has to wait a frame.
    requestAnimationFrame(() => {
        if (connected() && mode === 'grounded') place(intoBounds(x), groundY());
    });
    scheduleGroundLife();

    return {
        walk,
        hop,
        get state() {
            return { mode, animation, frame, direction, x, y };
        },
    };
}
