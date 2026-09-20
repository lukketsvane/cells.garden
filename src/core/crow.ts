import './shim';

/**
 * Ground crow atlas: 256 x 64 PNG, 8 x 2 cells, each frame 32 x 32 native pixels.
 *
 * Row 0 is the idle cycle, row 1 the walk cycle. The older 8 x 8 atlas carried
 * peck/call/hop/takeoff rows too, but its PNG stream was corrupt past scanline
 * 105: browsers dropped every row after the walk cycle, so each of those
 * animations drew nothing and the crow vanished for the whole run. Only the two
 * intact rows survive here, re-encoded as a valid PNG, and only these two rows
 * are ever addressed.
 */
export const CROW_ATLAS_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAABACAYAAAD1Xam+AAAE8ElEQVR42u2d0WrbSBSGj0OhpnHdRrJx4lICMYRC2Mtu9r53fYW+Vt+m7Ats79qbEHDBFDtr5MSJcUNys9qLMK4kS06gmjnTzPeBiYmNjvTPnDMjjaxfBAAAAAAAAAAAAAAAAAAAAB4LjcdwEM1WlHb7A2nvdEVEZDFP5Pvp5wbNC7CZJ48tAT993JPjD4k0W1F6s7xoUIQAqtn61Q28PnybFhPQJISLA8jGX8wTOf7wJZeU2Zet+NoaNFtR+vrwbXp0/D49On6/tj8Atc8AykbYuwRMct/Jfl7niFyMn0yGYivWQ4/ftQamAGWPXWsGBIEUANOhu/2BJBNJXSdgWfxuf7D63Pa0u+r4XRch7QIMEs5FQHN+W6S905XFPMn9z0YChh6/ugANV3+LkOxgZQbQ3ulKp/dqbdpb1gltEGL8qgI0OPpLFvPE6QwIAi8AZ6OTtQQwV75dJGHo8bULIEhYqwDZ0efH4lxERGbTsXz952+ZTcdrSWBz9AsxflkBKisKZTMEACurAJ3eq9UoNJuO5Wx0Itvt2NlOhxS/qgCdjU5kb/9NrggwCwCp+yKguej0rPVSRCTX6bIjkkmAZDKsfbkv9PjFAvDHn+9Wn2cLUN2xgVOAVYfaNMLZHH1Dj2+Kikn+vf03MpuOV6/sKUG3P3B28xEEcgoQ7R6k18tLSSZDedZ6WXoOWrUOXgehx79ZXjSarSjdbserIuC6AEGgM4Bo9yA3/d3U0Uznr3MKGnr87D6Y7Z+NTnIv2wUIArwGYDrd9fIyNwqZz3txR/57+uKugtxeyfR8VmvnDz1+cT/MvnT7g9JZgDn/5wYg+OVTgGYrSi/+/dbYeGdZ3EnNXWh133kWevxNBcgk+VoBIvnBJfv7h2nZe+LXt+pwX3zzC0Dznl4JKj8HBrGy6vCQ75nbfhn5wckTge4b7Uaj04arkZf47uMDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAID8Br8G9BWsudEfxK07sC+N74s7rrYOWvG19af4iN4DQYo+9J8+7j34qTY2npxz5477Jfed7MtmEmjpoBXfB/21dQ92BqBpTa1tT+6TRbdGfB/0xxpdqQBoNb5v7rjaSeA6vi/6+1T8JSRrsLLGb+90ZTFPcv+z1fjZfSi6486m45w7rs2k09RBM76m/j70P2YAHllTa9tz+6CDZnxN/bFGF92LgBrW1L7Zc/tg0e0yvk/6Y43ueAbgqzW1a3twbR18awdX+mON7uEqgOvkM1PLrD13duQpuuMmE3Gy/qyhg1Z8n/TX1j24AqDd+L6442rroBVfW38fi38wBcCH5NO25/ZBB834mvpjjS66y4Cm8UV+WmRXNYBNe24RXXdcH3TQiK+tv7buEvIqgGl8I/ymSlu3+NHuQWoa/3p5KcatN5kM5Xp5KdvtWJ4/fbL6u3V7Jb24Yy35tXTQiu+D/tq6BzsDqLKmNp+vWVOfz2q/6+y+bTVbUWr2Y+v2Smx441Xp0Is7q+/Y1EGrHbT119Y96GsAzVaUmmpfeWtl3EmTyTC39lqn+A/Z1s3yoiFxJ/1++rlhwx58ow5xJ3cLqg0dNNtBU39t3YM/BcCa2g8dQm0H+t9v9nNgH8hOO23MBrLbzm4fK243+qO7J08E8sWbvrgf2h3C9f5ot4Mv+vvWDwAAAAAAAAAAAAC85H8fjUAh3+1Q5QAAAABJRU5ErkJggg==';

export const CROW_PREVIEW_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABbUlEQVR4nO2VzU6DQBSFTxsTiRKUv9CfGJI2aXwB48P4Wr6N8QV06aZpggkxUMlQUIKmbhxXg0xL22EguuFbwTDcc++5cwHo6Ojo+Gd6bQRRVIPaoyk03QYAZCnBy+JRKHa/qfjF7IqW7+9uh0VSIu8fyQorqkHXecJVmaUE1zeE21N+vrlfKgEW1B5NQUIUAiT0uH1VYlUIbWI93kTTbWQp4dZEe8+o7YCm27CcMbeWpWTLAVFqH8KlP69MqsqhVhIo2/+RrQAAcRTg6eEecRRwScggNQWWMy7aEEcBlv4cp5oplcDBA8NO/Yl6DgAYupfcc9YSlgAJPeEJAARawILtq1C2ekDAAWMwoZ/5G4BfF3YlwCahNQeMwYSzf1+lMuLADgeYMKt8nSe98mfVMS18H58BAPpf74hWsZQ4UDEFimrQ5PV5KxAX3LQoCT1u9mXEpXHdGa26lqHx77gptWw7VK3vL/6uDR0dbfED34mHkrnn5lQAAAAASUVORK5CYII=';

type CrowAnimation = 'idle' | 'walk';
type CrowMode = 'grounded' | 'walking' | 'hopping';

const CROW_ANIMS: Record<CrowAnimation, { row: number; frames: number; duration: number }> = {
    idle: { row: 0, frames: 4, duration: 220 },
    walk: { row: 1, frames: 6, duration: 110 },
};

const CROW_COLUMNS = 8;
const CROW_ROWS = 2;
/** 2x the native 32 px frame. The scene reads as pixel art at this size. */
const CROW_SIZE = 64;
const CROW_HALF = CROW_SIZE / 2;
/** Clear of the world edge by half a crow plus a little air. */
const CROW_EDGE = CROW_HALF + 10;
/** The crow's feet sit this far above the box bottom, so this drops it on the soil. */
const CROW_FOOT = 22;
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
