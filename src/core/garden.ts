import './shim';
import Sortable, { SortableEvent } from 'sortablejs';
import type { GardenApp } from './app';
import { PLANT_TYPES } from './assets';
import { ICONS, setIcon, ZONE_ICONS } from './icons';
import { local } from './local';
import { openMenu, type MenuItem } from './menu';
import { ConfirmDeleteModal, CreateProjectModal, ShortcutsModal } from './modals';
import { View } from './ui';
import { mineralOpacity, skyAt } from './garden-settings';
import type { LayerItem, LayerName, ProjectData, ViewState } from './model';

declare const __CELLS_SYSTEM_CLIPBOARD__: boolean;
const systemClipboard =
    typeof __CELLS_SYSTEM_CLIPBOARD__ === 'boolean' ? __CELLS_SYSTEM_CLIPBOARD__ : true;
import {
    simpleHash,
    PIXEL_SCALE, PLANT_SPACING, CLOUD_SCROLL_DURATION,
    STEM_ORIGIN_WIDTH, STEM_ORIGIN_HEIGHT, STEM_OVERLAP_ORIGIN, FIXED_STACK_STEP,
} from './model';

// --- ASSET IMPORTS ---
import bgImageUrl from '../assets/bg_image.png';
import cloudUrl from '../assets/cloud.png';
import mountainsUrl from '../assets/mountains.png';
import groundUrl from '../assets/ground_tile.png';
import starsPatternUrl from '../assets/stars_pattern.gif';
import flower1Url from '../assets/pack/plant_1/flowers/flower1.png';
import flower2Url from '../assets/pack/plant_1/flowers/flower2.png';

import ant1Url from '../assets/ant_walk_1.png';
import ant2Url from '../assets/ant_walk_2.png';

import stem1Url from '../assets/pack/plant_1/stem/stem1.png';
import stem2Url from '../assets/pack/plant_1/stem/stem2.png';
import stem3Url from '../assets/pack/plant_1/stem/stem3.png';
import stem4Url from '../assets/pack/plant_1/stem/stem4.png';
import stem5Url from '../assets/pack/plant_1/stem/stem5.png';
import stem6Url from '../assets/pack/plant_1/stem/stem6.png';
import stem7Url from '../assets/pack/plant_1/stem/stem7.png';
import stem8Url from '../assets/pack/plant_1/stem/stem8.png';

/** Empty world on each side of the plants, in world px. Also where the first plant stands. */
const WORLD_PADDING = 320;
/** The middle of plant slot `i`, in world coordinates. */
const plantCentre = (i: number) => WORLD_PADDING + i * PLANT_SPACING + PLANT_SPACING / 2;
// How far past an edge a drag can stretch, in screen pixels, before it stops.
const RUBBER_REACH = 120;
// Frames a shooting star lives, long enough to fade in and out again.
const STAR_LIFE = 25;
// The smallest sky and ground the world ever has, whatever the plants do.
const BASE_SKY = 620;
const BASE_GROUND = 480;
/** Comfortable opening scale: enough scene around the plants to breathe. */
const DEFAULT_GARDEN_ZOOM = 0.34;
// Squares in the worm.
const WORM_LENGTH = 7;
// The most fireflies a garden setting can ask for.
const MAX_FIREFLIES = 64;

/** Cancel a timer or interval and hand back null, so `x = stop(x)` clears it. */
function stop(handle: number | null): null {
    if (handle !== null) {
        window.clearTimeout(handle);
        window.clearInterval(handle);
    }
    return null;
}

/** An image, once the browser knows its size. A broken one resolves too, at 0x0. */
function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img);
        img.src = url;
    });
}

const ZONE_LABELS: Record<LayerName, string> = {
    flowers: 'Flowers',
    stem: 'Stem',
    roots: 'Roots',
    minerals: 'Minerals',
};

const stemParts: string[] = [
    stem1Url, stem2Url, stem3Url, stem4Url,
    stem5Url, stem6Url, stem7Url, stem8Url
];
// --- 7. The Garden View ---

export class GardenView extends View {
    app: GardenApp;
    /** Called after every render, once the DOM is in place. The popup re-aims its camera here. */
    onRendered: (() => void) | null = null;
    private _hasLoadedInitialState = false;
    private _viewStateSaveTimeout: number | null = null;
    
    private isDragging = false;
        // --- Kanban Pan State ---
    private isPanningKanban = false;
    private kanbanStartX = 0;
    private kanbanStartY = 0;
    private kanbanScrollLeft = 0;
    private kanbanScrollTop = 0;
    private startX = 0;
    private startY = 0;
    private currentTranslateX = 0;
    private currentTranslateY = 0;
    private zoom = DEFAULT_GARDEN_ZOOM;
    private zoomMin = 0.15;
    private zoomMax = 3;


    // --- Touch State (Mobile) ---
    private isTouchPanning = false;
    private touchStartX = 0;
    private touchStartY = 0;
    private touchStartTranslateX = 0;
    private touchStartTranslateY = 0;

    private isPinching = false;
    private initialPinchDistance = 0;
    private initialPinchZoom = 1;
    private pinchCenterX = 0;
    private pinchCenterY = 0;
    private pinchWorldX = 0;
    private pinchWorldY = 0;

    // --- Mobile Touch Handlers ---
    private handleTouchStart = (e: TouchEvent) => {
        if (this.inPeek(e.target)) {
            this.pinPeek();
            return;
        }
        // Prevent the browser from doing its own scrolling/zooming
        if (e.touches.length > 0) e.preventDefault();

        const viewport = this.viewport;
        if (!viewport) return;
        this.cancelSettle();

        if (e.touches.length === 1) {
            // 1 Finger: Start Panning
            this.isTouchPanning = true;
            this.isPinching = false;
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
            this.touchStartTranslateX = this.currentTranslateX;
            this.touchStartTranslateY = this.currentTranslateY;
            this._touchTap = { x: this.touchStartX, y: this.touchStartY, t: performance.now() };
        } else if (e.touches.length === 2) {
            this._touchTap = null;
            // 2 Fingers: Start Pinching
            this.isTouchPanning = false;
            this.isPinching = true;
            
            const rect = viewport.getBoundingClientRect();
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            
            this.initialPinchDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            this.initialPinchZoom = this.zoom;
            
            // Calculate center of the two fingers relative to viewport
            this.pinchCenterX = ((t1.clientX + t2.clientX) / 2) - rect.left;
            this.pinchCenterY = ((t1.clientY + t2.clientY) / 2) - rect.top;
            
            // Calculate the world coordinates currently under the pinch center
            this.pinchWorldX = (this.pinchCenterX - this.currentTranslateX) / this.zoom;
            this.pinchWorldY = (this.pinchCenterY - this.currentTranslateY) / this.zoom;
        }
    };

    private handleTouchMove = (e: TouchEvent) => {
        if (this.inPeek(e.target)) return;
        if (e.touches.length > 0) e.preventDefault(); // Prevent page scroll

        const viewport = this.viewport;
        const world = this.world;
        if (!viewport || !world) return;

        if (this.isTouchPanning && e.touches.length === 1) {
            // 1 Finger Move: Pan
            const dx = e.touches[0].clientX - this.touchStartX;
            const dy = e.touches[0].clientY - this.touchStartY;
            const b = this.cameraBounds(world, viewport);
            this.currentTranslateX = this.softAxis(this.rawAxis(this.touchStartTranslateX, b.x) + dx, b.x);
            this.currentTranslateY = this.softAxis(this.rawAxis(this.touchStartTranslateY, b.y) + dy, b.y);
            this.applyWorldTransform(world, viewport);
        } else if (this.isPinching && e.touches.length === 2) {
            // 2 Fingers Move: Pinch Zoom
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            
            if (this.initialPinchDistance > 0) {
                let newZoom = this.initialPinchZoom * (currentDist / this.initialPinchDistance);
                newZoom = Math.max(this.minZoomFor(world, viewport), Math.min(this.zoomMax, newZoom));
                
                // Adjust translate to keep the pinch center stationary (just like scroll wheel zoom)
                this.currentTranslateX = this.pinchCenterX - (this.pinchWorldX * newZoom);
                this.currentTranslateY = this.pinchCenterY - (this.pinchWorldY * newZoom);
                this.zoom = newZoom;
                
                this.applyWorldTransform(world, viewport);
            }
        }
    };

    private handleTouchEnd = (e: TouchEvent) => {
        // If all fingers are lifted, stop everything and save the view state
        if (e.touches.length === 0) {
            const tap = this._touchTap;
            this._touchTap = null;
            const end = e.changedTouches[0];
            if (tap && end && Math.hypot(end.clientX - tap.x, end.clientY - tap.y) < 8 && performance.now() - tap.t < 400) {
                // touchstart is preventDefault()'d so iOS does not reliably synthesize
                // the click listener attached to a plant part. Resolve the part under
                // the lifted finger and focus its board cell directly.
                const target = this.containerEl.ownerDocument.elementFromPoint(end.clientX, end.clientY) as HTMLElement | null;
                const part = target?.closest<HTMLElement>('.garden-part[data-item-id]') ?? null;
                const wrapper = part?.closest<HTMLElement>('.garden-plant-wrapper') ?? null;
                const itemId = part?.dataset.itemId;
                const projectId = wrapper?.dataset.projectId;
                if (!this.boardHidden() && part && itemId && projectId) {
                    if (part.matches('.garden-stem-part, .garden-flower-part')) this.scareFireflies(projectId);
                    this.focusKanbanCell(itemId, projectId);
                } else {
                    this.peekTap(end.clientX, end.clientY, target ?? e.target);
                }
            }
            this.isTouchPanning = false;
            this.isPinching = false;
            this.settleCamera();
            this.scheduleViewStateSave();
        } else if (e.touches.length === 1 && this.isPinching) {
            // Transitioned from 2 fingers to 1 finger: start panning from the remaining finger
            this.isPinching = false;
            this.isTouchPanning = true;
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
            this.touchStartTranslateX = this.currentTranslateX;
            this.touchStartTranslateY = this.currentTranslateY;
        }
    };

    // --- View State ---

    // Camera + kanban scroll are per surface (web, newtab, sidepanel): a camera saved from a
    // wide New Tab page would leave the world off-screen in a 360px side panel. Kept in
    // localStorage on this device only, never in the synced garden blob.
    private _viewStateKey = 'cells.garden/view/' + (document.documentElement.dataset.context || 'web');

    private saveViewState() {
        const scrollContainer = this.contentEl.querySelector<HTMLElement>('.kanban-scroll-container');
        const state: ViewState = {
            zoom: this.zoom,
            translateX: this.currentTranslateX,
            translateY: this.currentTranslateY,
            kanbanScrollLeft: scrollContainer ? scrollContainer.scrollLeft : 0,
            kanbanScrollTop: scrollContainer ? scrollContainer.scrollTop : 0
        };
        // Private mode or blocked storage: the camera just starts centred next time.
        local.set(this._viewStateKey, JSON.stringify(state));
    }
    private scheduleViewStateSave() {
        if (this._viewStateSaveTimeout) window.clearTimeout(this._viewStateSaveTimeout);
        this._viewStateSaveTimeout = window.setTimeout(() => {
            this.saveViewState();
        }, 1000); // Wait 1 second after the last movement before saving to disk
    }
    /** Flush a pending debounced save immediately (tab closing, unmount). */
    saveViewStateNow() {
        if (this._viewStateSaveTimeout) window.clearTimeout(this._viewStateSaveTimeout);
        this._viewStateSaveTimeout = null;
        this.saveViewState();
    }
    private loadViewState(): ViewState | null {
        try {
            const raw = local.get(this._viewStateKey);
            if (!raw) return null;
            const s = JSON.parse(raw) as Partial<ViewState>;
            if (typeof s.zoom !== 'number' || typeof s.translateX !== 'number' || typeof s.translateY !== 'number') return null;
            return {
                zoom: s.zoom,
                translateX: s.translateX,
                translateY: s.translateY,
                kanbanScrollLeft: s.kanbanScrollLeft ?? 0,
                kanbanScrollTop: s.kanbanScrollTop ?? 0,
            };
        } catch {
            return null;
        }
    }

    /** True when the current camera still shows part of the world in this viewport. */
    private cameraInView(): boolean {
        const viewport = this.viewport;
        const world = this.world;
        if (!viewport || !world) return true;
        const vw = viewport.offsetWidth, vh = viewport.offsetHeight;
        const left = this.currentTranslateX, top = this.currentTranslateY;
        const right = left + world.offsetWidth * this.zoom;
        const bottom = top + world.offsetHeight * this.zoom;
        const margin = 40;
        return right > margin && left < vw - margin && bottom > margin && top < vh - margin;
    }



    
    // --- Shooting Star State ---
    private shootingStarCanvas: HTMLCanvasElement | null = null;
    private shootingStars: { x: number; y: number; angle: number; speed: number; life: number }[] = [];
    private showerAngle: number = Math.PI / 4;
    private showerRemaining: number = 0;
    private satellites: { el: HTMLElement; x: number; y: number; vx: number; vy: number; isUfo: boolean; turnTimer: number }[] = [];
    private satelliteLayer: HTMLElement | null = null;
    private shootingStarRAF: number | null = null;
    private nextShootingStarCheck: number = 0;
    private nightSkyState: 'unrolled' | 'dead' | 'normal' | 'shower' = 'unrolled';

    private startShootingStars() {
        if (this.shootingStarRAF !== null) return;
        const win = this.containerEl.ownerDocument.defaultView || window;

        /** A star anywhere in the top half of the sky. Without an angle, any angle. */
        const spawnStar = (angle = Math.random() * Math.PI * 2) => {
            const canvas = this.shootingStarCanvas;
            if (!canvas) return;
            this.shootingStars.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height * 0.5,
                angle,
                speed: 4 + Math.random() * 2,
                life: STAR_LIFE,
            });
        };

        const spawnSatellite = () => {
            if (!this.satelliteLayer) return;
            const satEl = this.satelliteLayer.createDiv('garden-satellite');

            const worldW = this.satelliteLayer.offsetWidth;
            const worldH = this.satelliteLayer.offsetHeight;
            
            const isUfo = Math.random() < 0.2; // 20% chance for a UFO!
            const startX = Math.random() < 0.5 ? 0 : worldW;
            const startY = Math.random() * worldH * 0.8;
            
            let angle;
            if (isUfo) {
                angle = Math.random() * Math.PI * 2;
            } else {
                angle = startX < 0 ? Math.random() * Math.PI : Math.PI + (Math.random() * Math.PI);
            }
            
            // Speeds are in 4x world space now (so 0.8 is equivalent to old 0.2)
            const speed = isUfo ? 1.0 + Math.random() * 0.5 : 0.6 + Math.random() * 0.4; 
            
            this.satellites.push({
                el: satEl,
                x: startX,
                y: startY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                isUfo,
                turnTimer: 0
            });
        };

                const animate = (time: number) => {
            const ctx = this.shootingStarCanvas?.getContext('2d');
            if (!ctx || !this.shootingStarCanvas) {
                this.nextShootingStarCheck = time + 5000; 
                this.shootingStarRAF = win.requestAnimationFrame(animate);
                return;
            }

            // Get current sky state to calculate fade alpha
            const state = this.getDayNightState();
            // starOpacity is 0 to 0.35. Scale it to 0 to 1 for full brightness.
            const fadeAlpha = Math.min(1, state.starOpacity * 3);

            // 1. Clear the star canvas completely every frame
            ctx.clearRect(0, 0, this.shootingStarCanvas.width, this.shootingStarCanvas.height);

            // Apply global alpha to all canvas drawings (shooting stars)
            ctx.globalAlpha = fadeAlpha;

            // 2. Spawning Logic
            if (time > this.nextShootingStarCheck) {
                if (state.starOpacity > 0.1 && this.nightSkyState === 'unrolled') {
                    const roll = Math.random();
                    if (roll < 0.15) this.nightSkyState = 'shower';
                    else if (roll < 0.30) this.nightSkyState = 'dead';
                    else this.nightSkyState = 'normal';
                } else if (state.starOpacity <= 0.1) {
                    this.nightSkyState = 'unrolled';
                }

                if (state.starOpacity > 0.1 && this.nightSkyState !== 'unrolled') {
                    if (Math.random() < 0.25) {
                        spawnSatellite();
                        this.nextShootingStarCheck = time + 15000 + Math.random() * 15000; 
                    } else {
                        if (this.nightSkyState === 'shower') {
                            if (this.showerRemaining <= 0) {
                                this.showerRemaining = 2 + Math.floor(Math.random() * 3); 
                                this.showerAngle = Math.PI / 4 + (Math.random() - 0.5) * Math.PI / 2; 
                                this.nextShootingStarCheck = time + 1000 + Math.random() * 2000; 
                            } else {
                                // A shower's stars all fall roughly the same way.
                                spawnStar(this.showerAngle + (Math.random() - 0.5) * 0.52);
                                this.showerRemaining--;
                                if (this.showerRemaining > 0) {
                                    this.nextShootingStarCheck = time + 300 + Math.random() * 500; 
                                } else {
                                    this.nextShootingStarCheck = time + 5000 + Math.random() * 5000; 
                                }
                            }
                        } else if (this.nightSkyState === 'normal') {
                            this.nextShootingStarCheck = time + 30000 + Math.random() * 60000; 
                            spawnStar();
                            if (Math.random() < 0.3) spawnStar(); 
                        } else {
                            this.nextShootingStarCheck = time + 30000; 
                        }
                    }
                } else {
                    this.nextShootingStarCheck = time + 10000; 
                }
            }

            // 3. Draw and Update Shooting Stars (Canvas)
            ctx.lineWidth = 1; 
            ctx.lineCap = 'square';

            for (let i = this.shootingStars.length - 1; i >= 0; i--) {
                const s = this.shootingStars[i];
                const vx = Math.cos(s.angle) * s.speed;
                const vy = Math.sin(s.angle) * s.speed;

                // 1. Calculate smooth sine-wave fade (0 to 1 to 0 over lifespan)
                const progress = 1 - s.life / STAR_LIFE;
                const fadeAlpha = Math.sin(progress * Math.PI) * 0.55; // Peaks at 0.55 in the middle!

                // 2. Draw a perfect, straight 1-pixel line trail
                const tailDist = 10; // 10px in 1x space (40px on screen)
                // Normalize by speed so the tail length is perfectly consistent
                const tailX = s.x - (vx / s.speed) * tailDist; 
                const tailY = s.y - (vy / s.speed) * tailDist;
                
                const gradient = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
                gradient.addColorStop(0, `rgba(255, 255, 255, ${fadeAlpha})`); // Head brightness
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0)'); // Tail fades to 0
                
                ctx.strokeStyle = gradient;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(tailX, tailY);
                ctx.stroke();

                // Move forward
                s.x += vx;
                s.y += vy;
                s.life--;

                // Remove if dead or off-screen
                if (s.life <= 0 || s.x > this.shootingStarCanvas.width + 10 || s.x < -10 || s.y > this.shootingStarCanvas.height + 10 || s.y < -10) {
                    this.shootingStars.splice(i, 1);
                }
            }
            
            // Reset global alpha so we don't accidentally affect anything else
            ctx.globalAlpha = 1;

            // 4. Update Satellites (DOM)
            for (let i = this.satellites.length - 1; i >= 0; i--) {
                const s = this.satellites[i];
                
                if (s.isUfo && time > s.turnTimer) {
                    s.turnTimer = time + 1000 + Math.random() * 2000; 
                    const newAngle = Math.random() * Math.PI * 2;
                    const currentSpeed = Math.sqrt(s.vx*s.vx + s.vy*s.vy);
                    s.vx = Math.cos(newAngle) * currentSpeed;
                    s.vy = Math.sin(newAngle) * currentSpeed;
                }

                s.x += s.vx;
                s.y += s.vy;
                
                // Apply the fade alpha to the DOM element as well!
                s.el.style.opacity = String(fadeAlpha);
                s.el.style.transform = `translate3d(${s.x}px, ${s.y}px, 0)`;

                const worldW = this.satelliteLayer?.offsetWidth || 800;
                const worldH = this.satelliteLayer?.offsetHeight || 600;

                // Remove as soon as they cross the world edge
                if (s.x < -5 || s.x > worldW + 5 || s.y < -5 || s.y > worldH + 5) {
                    s.el.remove();
                    this.satellites.splice(i, 1);
                }
            }

            this.shootingStarRAF = win.requestAnimationFrame(animate);
        };

        this.shootingStarRAF = win.requestAnimationFrame(animate);
    }

    private stopShootingStars() {
        if (this.shootingStarRAF !== null) {
            const win = this.containerEl.ownerDocument.defaultView || window;
            win.cancelAnimationFrame(this.shootingStarRAF);
            this.shootingStarRAF = null;
        }
        if (this.shootingStarCanvas) {
            const ctx = this.shootingStarCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, this.shootingStarCanvas.width, this.shootingStarCanvas.height);
        }
        this.shootingStars = [];
        
        this.satellites.forEach(s => s.el.remove());
        this.satellites = [];
    }

    // --- Ant State ---
    private antX: number = 50;
    private antDirection: number = 1;
    private antFrame: number = 0;
    private antWalkInterval: number | null = null;
    private antBreakTimeout: number | null = null;
    private antTurnTimeout: number | null = null;
    private isWalking: boolean = false;
    private antInitialized: boolean = false;

    // --- Worm State ---
    private wormSegments: { x: number; y: number }[] = [];
    private wormDir: { x: number; y: number } = { x: 1, y: 0 };
    private wormNextDir: { x: number; y: number } = { x: 1, y: 0 };
    private wormInterval: number | null = null;
    private wormTurnTimeout: number | null = null;
    private wormBreakTimeout: number | null = null;
    private wormElRefs: HTMLElement[] = [];
    private wormPixelSize = 4;
    private wormSpeed = 960; // ms per tick (1/3 of current speed)
    private wormTrailCanvas: HTMLCanvasElement | null = null;
    private wormIsRunning = false;
    private wormHitboxEl: HTMLElement | null = null;
    private _savedWormSegments: { x: number; y: number }[] | null = null;
    private _savedWormDir: { x: number; y: number } | null = null;
    private _savedWormNextDir: { x: number; y: number } | null = null;
    private _dynamicGroundLineY = 0; // Set during rendering, used by worm bounds
    private _skyUpdateInterval: number | null = null;

    // --- Firefly State ---
    private fireflyState: {
        el: HTMLElement;
        cx: number; cy: number; 
        vx: number; vy: number; 
        rx: number; ry: number; 
        drx: number; dry: number; // Radius velocities for morphing loops!
        spX: number; spY: number; 
        phase: number;
        isLanded: boolean;
        landedUntil: number;
        landedX: number;
        landedY: number;
    }[] = [];
    private fireflyRAF: number | null = null;
    private fireflySkyHeight: number = 0;

    // --- Drawing Mode State ---
    private isDrawingMode = false;
    private selectedToolEraser = false; // Tracks which toolbar button is active
    private isActivelyErasing = false;  // Tracks what the current mouse stroke is doing
    private isCurrentlyDrawing = false;
    private drawingToolbarEl: HTMLElement | null = null;
    private lastDrawX = 0;
    private lastDrawY = 0;

    // --- The Ant Logic ---
    private startAnt() {
        // Only reset position on the very first call ever, not on re-renders
        if (!this.antInitialized) {
            this.antX = 50;
            this.antDirection = 1;
            this.antInitialized = true;
        }
        this.isWalking = true;

        this.resumeWalking();
        this.scheduleAntBreak();
    }

    private resumeWalking() {
        if (this.antWalkInterval) return; // Already walking

        const walkLogic = () => {
            const world = this.world;
            const worldWidth = world ? world.offsetWidth : 800;
            // Fixed speed (20 pixels per second). No longer scales with world width.
            const speed = 2; 
            this.antX += speed * this.antDirection;
            this.antFrame = this.antFrame === 0 ? 1 : 0;

            if (world) {
                if (this.antX > worldWidth - 30) this.antDirection = -1;
                if (this.antX < 30) this.antDirection = 1;
            }

            const antEl = this.containerEl.querySelector('.garden-ant') as HTMLElement;
            if (antEl) {
                antEl.style.left = `${this.antX}px`;
                antEl.style.transform = this.antDirection === 1 ? 'scaleX(1)' : 'scaleX(-1)';
                const imgUrl = this.antFrame === 0 ? ant1Url : ant2Url;
                antEl.style.backgroundImage = imgUrl ? `url(${imgUrl})` : 'none';
            }
        };

        this.antWalkInterval = window.setInterval(walkLogic, 100);

        // Schedule a random turn while walking (0.5 to 3 seconds)
        this.scheduleRandomTurn();
    }

    private scheduleRandomTurn() {
        stop(this.antTurnTimeout);

        const turnTime = 2000 + Math.random() * 4000;
        this.antTurnTimeout = window.setTimeout(() => {
            if (!this.isWalking) return;

            // 25% chance to turn around, 75% chance to keep going
            if (Math.random() < 0.25) {
                this.antDirection *= -1;
            }

            // Schedule the next potential turn
            this.scheduleRandomTurn();
        }, turnTime);
    }

    private stopAnt() {
        this.isWalking = false;
        this.antWalkInterval = stop(this.antWalkInterval);
        this.antBreakTimeout = stop(this.antBreakTimeout);
        this.antTurnTimeout = stop(this.antTurnTimeout);
    }

    /** Walk 4-10 seconds, stand still for half a second to two, then again. */
    private scheduleAntBreak() {
        stop(this.antBreakTimeout);
        this.antBreakTimeout = window.setTimeout(() => {
            this.antWalkInterval = stop(this.antWalkInterval);
            this.antTurnTimeout = stop(this.antTurnTimeout);
            this.antBreakTimeout = window.setTimeout(() => {
                this.resumeWalking();
                this.scheduleAntBreak();
            }, 500 + Math.random() * 1500);
        }, 4000 + Math.random() * 6000);
    }

    // --- The Worm Logic ---
    private startWorm() {
        this.stopWorm();



        
        const world = this.world;
        if (!world) return;

        const seg = this.wormPixelSize;

        // Restore saved worm state if available (preserves position across re-renders)
        if (this._savedWormSegments?.length === WORM_LENGTH) {
            this.wormSegments = this._savedWormSegments.map(s => ({ ...s }));
            this.wormDir = this._savedWormDir ? { ...this._savedWormDir } : { x: 1, y: 0 };
            this.wormNextDir = this._savedWormNextDir ? { ...this._savedWormNextDir } : { x: 1, y: 0 };
            // Clamp restored positions to underground area (layout may have changed)
            const worldW = world.offsetWidth;
            const worldH = world.offsetHeight;
            const glY = this._dynamicGroundLineY;
            for (const s of this.wormSegments) {
                if (s.y < glY + seg) s.y = glY + seg;
                if (s.y + seg > worldH) s.y = worldH - seg * 2;
                if (s.x < 0) s.x = 0;
                if (s.x + seg > worldW) s.x = worldW - seg;
            }
        } else {
            // First spawn: place in the middle of the underground area
            const worldW = world.offsetWidth;
            const worldH = world.offsetHeight;
            const groundLineY = this._dynamicGroundLineY;
            const startX = Math.floor(worldW / 2 / seg) * seg;
            const startY = Math.floor((groundLineY + (worldH - groundLineY) / 2) / seg) * seg;
            this.wormSegments = [];
            this.wormDir = { x: 1, y: 0 };
            this.wormNextDir = { x: 1, y: 0 };
            for (let i = 0; i < WORM_LENGTH; i++) {
                this.wormSegments.push({ x: startX - i * seg, y: startY });
            }
        }

        // Set initial positions on the DOM elements immediately (no flash at 0,0)
        this.wormElRefs.forEach((el, i) => {
            if (this.wormSegments[i]) {
                el.style.left = `${this.wormSegments[i].x}px`;
                el.style.top = `${this.wormSegments[i].y}px`;
            }
        });
        this.updateWormHitbox();

        this.wormIsRunning = true;
        this.resumeWorm();
        this.scheduleWormTurn();
        this.scheduleWormBreak();
    }

    private resumeWorm() {
        if (this.wormInterval) return;

        const moveLogic = () => {
            const world = this.world;
            if (!world) return;

            const worldW = world.offsetWidth;
            const worldH = world.offsetHeight;
            const groundLineY = this._dynamicGroundLineY;
            const seg = this.wormPixelSize;

            // Apply queued direction (prevents 180° turns)
            this.wormDir = { ...this.wormNextDir };

            // Calculate new head position
            const head = this.wormSegments[0];
            let newX = head.x + this.wormDir.x * seg;
            let newY = head.y + this.wormDir.y * seg;

            // Bounce off underground boundaries (ground line at top, world bottom)
            if (newX < 0 || newX >= worldW) {
                this.wormDir.x *= -1;
                this.wormNextDir.x *= -1;
                newX = head.x + this.wormDir.x * seg;
            }
            if (newY < groundLineY || newY >= worldH) {
                this.wormDir.y *= -1;
                this.wormNextDir.y *= -1;
                newY = head.y + this.wormDir.y * seg;
            }

            // Record old tail position for the trail
            const oldTail = this.wormSegments[this.wormSegments.length - 1];

            // Move: each segment takes the position of the one ahead of it
            for (let i = this.wormSegments.length - 1; i > 0; i--) {
                this.wormSegments[i] = { ...this.wormSegments[i - 1] };
            }
            this.wormSegments[0] = { x: newX, y: newY };

            // Draw trail pixel on canvas (dirt tunnel effect)
            // Canvas is ground-only, so offset Y by groundLineY
            if (this.wormTrailCanvas) {
                const ctx = this.wormTrailCanvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
                    ctx.fillRect(oldTail.x, oldTail.y - groundLineY, seg, seg);
                }
            }

            // Update DOM
            this.wormElRefs.forEach((el, i) => {
                if (this.wormSegments[i]) {
                    el.style.left = `${this.wormSegments[i].x}px`;
                    el.style.top = `${this.wormSegments[i].y}px`;
                }
            });
            this.updateWormHitbox();
        };

        this.wormInterval = window.setInterval(moveLogic, this.wormSpeed);
    }

    private pauseWorm() {
        this.wormInterval = stop(this.wormInterval);
        this.wormTurnTimeout = stop(this.wormTurnTimeout);
    }

    private scheduleWormTurn() {
        stop(this.wormTurnTimeout);

        const turnTime = 1000 + Math.random() * 4000;
        this.wormTurnTimeout = window.setTimeout(() => {
            if (!this.wormIsRunning) return;

            // Pick a random direction that isn't a 180° reversal
            const dirs = [
                { x: 0, y: -1 }, // up
                { x: 0, y: 1 },  // down
                { x: -1, y: 0 }, // left
                { x: 1, y: 0 },  // right
            ];
            const validDirs = dirs.filter(d => !(d.x === -this.wormDir.x && d.y === -this.wormDir.y));
            const chosen = validDirs[Math.floor(Math.random() * validDirs.length)];
            this.wormNextDir = chosen;

            this.scheduleWormTurn();
        }, turnTime);
    }

    private scheduleWormBreak() {
        stop(this.wormBreakTimeout);
        this.wormBreakTimeout = window.setTimeout(() => {
            this.pauseWorm();
            this.wormBreakTimeout = window.setTimeout(() => {
                this.resumeWorm();
                this.scheduleWormTurn();
                this.scheduleWormBreak();
            }, 3000 + Math.random() * 6000);
        }, 4000 + Math.random() * 8000);
    }

    private stopWorm() {
        this.wormIsRunning = false;
        // Save worm state before stopping (for preservation across re-renders)
        if (this.wormSegments.length > 0) {
            this._savedWormSegments = this.wormSegments.map(s => ({ ...s }));
            this._savedWormDir = { ...this.wormDir };
            this._savedWormNextDir = { ...this.wormNextDir };
        }
        this.pauseWorm();
        this.wormBreakTimeout = stop(this.wormBreakTimeout);
    }

    private createWormElements(parent: HTMLElement) {
        const seg = this.wormPixelSize;
        this.wormElRefs = [];

        // One box around the whole worm, so hovering or clicking any part of it counts.
        const hitbox = parent.createDiv("garden-worm-hitbox");
        hitbox.addEventListener('click', (e) => {
            e.stopPropagation();
            this.enterDrawingMode();
        });
        hitbox.addEventListener('mouseenter', () => parent.addClass('garden-worm-pulsing'));
        hitbox.addEventListener('mouseleave', () => parent.removeClass('garden-worm-pulsing'));
        this.wormHitboxEl = hitbox;

        // The body: seven squares that follow each other, and nothing else.
        const colors = ['#382c38', '#312b31'];
        for (let i = 0; i < WORM_LENGTH; i++) {
            const el = parent.createDiv("garden-worm-segment");
            el.style.width = `${seg}px`;
            el.style.height = `${seg}px`;
            el.style.backgroundColor = colors[i % 2];
            this.wormElRefs.push(el);
        }
    }


    // --- The Firefly Logic ---
    private createFireflies(parent: HTMLElement, skyHeight: number) {
        this.fireflySkyHeight = skyHeight;
        this.fireflyState = [];
        parent.empty();

        const count = Math.min(MAX_FIREFLIES, Math.max(0, Math.round(this.app.settings.fireflies) || 0));
        for (let i = 0; i < count; i++) {
            const el = parent.createDiv("garden-firefly");

            const cx = Math.random() * parent.offsetWidth;
            const minStartY = Math.max(10, skyHeight - 100);
            const maxStartY = skyHeight - 10;
            const cy = minStartY + (Math.random() * (maxStartY - minStartY));

            // Drift speed reduced to 1/4 (very slow meandering)
            const vx = (Math.random() - 0.5) * 0.2; 
            const vy = (Math.random() - 0.5) * 0.1;

            // Starting radii
            const rx = 15 + Math.random() * 30;
            const ry = 10 + Math.random() * 25;

            // Starting radius velocities (so the loops constantly morph over time)
            const drx = (Math.random() - 0.5) * 0.05;
            const dry = (Math.random() - 0.5) * 0.05;

            // Orbit speed reduced to 1/4 (very lazy looping)
            const spX = 0.00025 + Math.random() * 0.00075;
            const spY = 0.00025 + Math.random() * 0.00075;

            const phase = Math.random() * Math.PI * 2;

            const blinkDuration = 1.5 + Math.random() * 2.5;
            el.style.animation = `garden-firefly-blink ${blinkDuration}s ease-in-out infinite`;
            
            this.fireflyState.push({ 
                el, cx, cy, vx, vy, rx, ry, drx, dry, spX, spY, phase, 
                isLanded: false, landedUntil: 0, landedX: 0, landedY: 0 
            });
            
            el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
        }
    }

    private startFireflies() {
        if (this.fireflyRAF !== null) return;

        // 1. Fade them in
        for (const f of this.fireflyState) {
            f.el.setCssStyles({ opacity: '1' });
        }

        const world = this.world;
        if (!world) return;

        // Cache plant bounds for landing
        const plantWrappers = Array.from(world.querySelectorAll<HTMLElement>('.garden-plant-wrapper'));
        const plantBounds = plantWrappers.map(p => {
            if (!p.querySelector('.garden-stem-part, .garden-flower-part')) return null;
            const leftStr = p.style.left;
            const center = leftStr ? parseFloat(leftStr) : 0;
            const width = parseInt(p.dataset.width || '30'); 
            return { left: center - (width / 2), right: center + (width / 2) };
        }).filter(b => b !== null) as { left: number, right: number }[];

        const win = this.containerEl.ownerDocument.defaultView || window;

        const animate = (time: number) => {
            const maxX = world.offsetWidth - 10;
            const minY = this.fireflySkyHeight - 350; 
            const maxY = this.fireflySkyHeight - 5;   

            for (const f of this.fireflyState) {
                // --- LANDED STATE ---
                if (f.isLanded) {
                    if (time < f.landedUntil) {
                        f.el.style.transform = `translate3d(${f.landedX}px, ${f.landedY}px, 0)`;
                        continue; 
                    } else {
                        // Take off!
                        f.isLanded = false;
                        f.cx = f.landedX;
                        f.cy = f.landedY;
                    }
                }

                // --- WANDERING DRIFT CENTER ---
                // Reduced steering force to 1/4 so they turn very slowly
                f.vx += (Math.random() - 0.5) * 0.0125;
                f.vy += (Math.random() - 0.5) * 0.0125;

                // Cap drift speed to 1/4 (0.25)
                const driftSpeed = Math.sqrt(f.vx*f.vx + f.vy*f.vy);
                const maxDrift = 12.25;
                if (driftSpeed > maxDrift) {
                    f.vx = (f.vx / driftSpeed) * maxDrift;
                    f.vy = (f.vy / driftSpeed) * maxDrift;
                }

                f.cx += f.vx;
                f.cy += f.vy;

                // Boundary clamping for the drift center (accounts for loop radius so they never bump the ground!)
                const minCy = minY + f.ry;
                const maxCy = maxY - f.ry;
                if (minCy > maxCy) { f.cy = (minY + maxY) / 2; } // Fallback if area too small
                else { f.cy = Math.max(minCy, Math.min(maxCy, f.cy)); }

                const minCx = 10 + f.rx;
                const maxCx = maxX - f.rx;
                if (minCx > maxCx) { f.cx = (10 + maxX) / 2; }
                else { f.cx = Math.max(minCx, Math.min(maxCx, f.cx)); }

                // --- MORPHING RADII ---
                // Wander the radii velocities so the loop shape constantly changes
                f.drx += (Math.random() - 0.5) * 0.02;
                f.dry += (Math.random() - 0.5) * 0.02;

                // Clamp the radii velocities so they don't spin out of control
                f.drx = Math.max(-0.1, Math.min(0.1, f.drx));
                f.dry = Math.max(-0.1, Math.min(0.1, f.dry));

                // Apply to radii
                f.rx += f.drx;
                f.ry += f.dry;

                // Bounce the radii off min/max bounds so they grow and shrink endlessly
                if (f.rx < 5 || f.rx > 75) f.drx *= -1;
                if (f.ry < 5 || f.ry > 60) f.dry *= -1;

                // --- LISSAJOUS FLUTTER ---
                let x = f.cx + Math.sin(time * f.spX + f.phase) * f.rx;
                let y = f.cy + Math.sin(time * f.spY + f.phase) * f.ry;

                // --- LANDING DETECTION ---
                const isNearGround = y >= this.fireflySkyHeight - 60;
                
                if (isNearGround) {
                    for (const bound of plantBounds) {
                        if (x >= bound.left && x <= bound.right) {
                            if (Math.random() < 0.02) {
                                f.isLanded = true;
                                f.landedX = x;
                                f.landedY = y;
                                f.landedUntil = time + 4000 + Math.random() * 56000;
                                f.el.style.transform = `translate3d(${f.landedX}px, ${f.landedY}px, 0)`;
                                break;
                            }
                        }
                    }
                    if (f.isLanded) continue;
                }

                f.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            }

            this.fireflyRAF = win.requestAnimationFrame(animate);
        };

        this.fireflyRAF = win.requestAnimationFrame(animate);
    }

    private stopFireflies() {
        if (this.fireflyRAF !== null) {
            const win = this.containerEl.ownerDocument.defaultView || window;
            win.cancelAnimationFrame(this.fireflyRAF);
            this.fireflyRAF = null;
        }
    }

    private updateWormHitbox() {
        if (!this.wormHitboxEl || this.wormSegments.length === 0) return;
        const seg = this.wormPixelSize;
        const pad = 2; // padding inside the outline
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const s of this.wormSegments) {
            if (s.x < minX) minX = s.x;
            if (s.y < minY) minY = s.y;
            if (s.x + seg > maxX) maxX = s.x + seg;
            if (s.y + seg > maxY) maxY = s.y + seg;
        }
        this.wormHitboxEl.style.left = `${minX - pad}px`;
        this.wormHitboxEl.style.top = `${minY - pad}px`;
        this.wormHitboxEl.style.width = `${maxX - minX + pad * 2}px`;
        this.wormHitboxEl.style.height = `${maxY - minY + pad * 2}px`;
    }


    constructor(host: HTMLElement, app: GardenApp) {
        super(host);
        this.app = app;
    }

    private _renderGeneration = 0; // Guards against concurrent onOpen() calls
    private _renderDebounce: number | null = null;

    /** onOpen, debounced, so a run of fast edits draws the garden once. */
    scheduleRender() {
        this._renderDebounce = stop(this._renderDebounce);
        const win = this.containerEl.ownerDocument.defaultView || window;
        this._renderDebounce = win.setTimeout(() => {
            // A sync from another tab or device must not throw away a cell being
            // written: wait until the typing is done, then render.
            if (this.isTyping()) this.scheduleRender();
            else void this.onOpen();
        }, 80);
    }

    private isTyping(): boolean {
        const active = this.containerEl.ownerDocument.activeElement as HTMLElement | null;
        return !!active && this.contentEl.contains(active) && active.isContentEditable;
    }

    async onOpen() {
        this.installShortcuts();
        const thisGeneration = ++this._renderGeneration;
        try {
            // Stop animations BEFORE destroying the DOM to prevent stale intervals
            this.stopAnt();
            this.stopWorm();
            this.stopFireflies();
            this.stopShootingStars();

            // Only load from hard drive on the very first render (app startup)
            const persistedState = !this._hasLoadedInitialState ? this.loadViewState() : null;
            
            // Save current scroll positions BEFORE destroying the DOM
            const scrollStates = this.saveScrollPositions();
            
            if (persistedState) {
                // App just started: override camera coordinates with saved ones from data.json
                this.zoom = persistedState.zoom;
                this.currentTranslateX = persistedState.translateX;
                this.currentTranslateY = persistedState.translateY;
                scrollStates.selectors = scrollStates.selectors.map(s => {
                    if (s.selector.startsWith('.kanban-scroll-container')) {
                        return { ...s, scrollLeft: persistedState.kanbanScrollLeft, scrollTop: persistedState.kanbanScrollTop };
                    }
                    return s;
                });
            }
            // If no persistedState, we do nothing! this.zoom and this.currentTranslateX naturally persist!


            // Save canvas content before DOM is destroyed
            let savedCanvasImage: string | null = null;
            const oldGroundLineY = this._dynamicGroundLineY;
            if (this.wormTrailCanvas) {
                try { savedCanvasImage = this.wormTrailCanvas.toDataURL(); } catch { /* unreadable canvas: the trail starts over */ }
            }

            const container = this.contentEl;
            if (!container) return;

            container.addClass("garden-container");
            // Build the new garden hidden behind the old one and swap them in one go.
            // Emptying first showed a blank board for as long as the images took to
            // load, then a jump back to the scroll position: the board shook on
            // every edit.
            if (getComputedStyle(container).position === 'static') container.setCssStyles({ position: 'relative' });
                const stage = container.createDiv('garden-render-stage');
            try {
                await this.renderGarden(stage);
            } catch (e) {
                stage.remove();
                throw e;
            }

            // If another onOpen() was triggered while we were rendering, abort this one
            if (this._renderGeneration !== thisGeneration) {
                stage.remove();
                return;
            }
            for (const child of Array.from(container.children)) {
                if (child !== stage) child.remove();
            }
            while (stage.firstChild) container.appendChild(stage.firstChild);
            stage.remove();
            this.settleCamera(false);
            this.restorePeek();
            // Canvas is now ground-only; offset by old ground line to align content
            if (savedCanvasImage && this.wormTrailCanvas) {
                const img = new Image();
                img.onload = () => {
                    const ctx = this.wormTrailCanvas?.getContext('2d');
                    if (ctx) {
                        // Offset by how much the ground line shifted between renders
                        const yOffset = this._dynamicGroundLineY - oldGroundLineY;
                        ctx.drawImage(img, 0, yOffset);
                    }
                };
                img.src = savedCanvasImage;
            }

            // --- VIEW RESTORATION ---
            if (!this._hasLoadedInitialState) {
                this._hasLoadedInitialState = true; // Mark as done so this only runs once ever!
                
                if (!persistedState || !this.cameraInView()) {
                    // No usable saved state (none, or saved by a surface of another size): centre the view.
                    const win = this.containerEl.ownerDocument.defaultView || window;
                    win.requestAnimationFrame(() => {
                        win.requestAnimationFrame(() => {
                            const viewport = this.viewport;
                            const world = this.world;
                            if (viewport && world) {
                                this.zoom = DEFAULT_GARDEN_ZOOM;
                                const vpWidth = viewport.offsetWidth || 800;
                                const vpHeight = viewport.offsetHeight || 600;
                                const plantCount = this.app.gardenData.length;
                                const middlePlantIndex = Math.floor(plantCount / 2);
                                const middlePlantWorldX = plantCentre(middlePlantIndex);
                                
                                this.currentTranslateX = (vpWidth / 2) - (middlePlantWorldX * this.zoom);
                                this.currentTranslateY = (vpHeight * 0.65) - (this._dynamicGroundLineY * this.zoom);
                                this.applyWorldTransform(world, viewport);
                                this.settleCamera(false);
                            }

                            const scrollContainer = this.contentEl.querySelector('.kanban-scroll-container') as HTMLElement;
                            if (scrollContainer) {
                                const middle = (scrollContainer.scrollWidth - scrollContainer.clientWidth) / 2;
                                const cols = scrollContainer.querySelectorAll('.project-column');
                                const firstCol = cols[0] as HTMLElement | undefined;
                                const secondCol = cols[1] as HTMLElement | undefined;
                                const columnStep = firstCol && secondCol
                                    ? secondCol.offsetLeft - firstCol.offsetLeft
                                    : (firstCol?.offsetWidth ?? 0);
                                scrollContainer.scrollLeft = columnStep > 0
                                    ? Math.round(middle / columnStep) * columnStep
                                    : middle;
                            }
                            this.saveViewState();
                        });
                    });
                } else {
                    // We had a saved state, restore the Kanban scroll
                    this.restoreScrollPositions(scrollStates);
                }
            } else {
                // Normal re-render (e.g. adding a plant). Camera stayed still, just restore Kanban scroll.
                this.restoreScrollPositions(scrollStates);
            }
            

            this.startAnt();
            this.startWorm();
            this.startFireflies();
            this.startShootingStars();
            this.onRendered?.();
            


        } catch (e: unknown) {
            console.error("GARDEN CELLS CRASH IN ONOPEN:", e);
            const container = this.contentEl;
            if (container) {
                container.createEl("h2", { text: "Garden Crashed" });
                container.createEl("p", { text: String(e) });
            }
        }
    }

    // --- Drawing Mode ---
    private enterDrawingMode() {
        this.isDrawingMode = true;
        this.selectedToolEraser = false;
        this.showDrawingToolbar();
        const viewport = this.viewport;
        if (!viewport) return;
        viewport.addClass('is-drawing');
        viewport.addEventListener('mousedown', this.handleDrawStart);
        viewport.addEventListener('contextmenu', this.preventContextMenu);
    }

    private exitDrawingMode() {
        this.isDrawingMode = false;
        this.isCurrentlyDrawing = false;
        this.drawingToolbarEl?.remove();
        this.drawingToolbarEl = null;
        const viewport = this.viewport;
        if (!viewport) return;
        viewport.removeClass('is-drawing');
        viewport.removeEventListener('mousedown', this.handleDrawStart);
        viewport.removeEventListener('contextmenu', this.preventContextMenu);
    }

    private handleDrawStart = (e: MouseEvent) => {
        if (!this.isDrawingMode) return;
        // Middle mouse (button 1) pans instead!
        if (e.button === 1) return; 
        
        // Don't draw/erase if clicking on the toolbar
        if ((e.target as HTMLElement).closest('.drawing-toolbar')) return;

        const viewport = this.viewport;

        if (e.button === 2) {
            // Right click ALWAYS erases, regardless of selected tool
            this.isActivelyErasing = true;
        } else if (e.button === 0) {
            // Left click uses the selected tool
            this.isActivelyErasing = this.selectedToolEraser;
        } else {
            return;
        }

        // Right-dragging with the pencil in hand still shows the eraser.
        viewport?.toggleClass('is-erasing', this.isActivelyErasing);

        this.isCurrentlyDrawing = true;
        this.lastDrawX = -1; // No last point yet: the stroke starts as a dot.
        this.drawOnCanvas(e);
    };

    private preventContextMenu = (e: MouseEvent) => {
        e.preventDefault();
    };

    private screenToCanvasCoords(e: MouseEvent): { x: number; y: number } | null {
        if (!this.wormTrailCanvas) return null;
        const rect = this.wormTrailCanvas.getBoundingClientRect();
        // rect is the CSS-displayed size of the canvas (affected by zoom/pan transform)
        // canvas.width/height is the pixel resolution
        const scaleX = this.wormTrailCanvas.width / rect.width;
        const scaleY = this.wormTrailCanvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    private drawOnCanvas(e: MouseEvent) {
        if (!this.wormTrailCanvas) return;
        const ctx = this.wormTrailCanvas.getContext('2d');
        if (!ctx) return;
        const coords = this.screenToCanvasCoords(e);
        if (!coords) return;

        const brush = this.isActivelyErasing ? 32 : 4;
        ctx.fillStyle = 'rgba(0, 0, 0, 1)';
        ctx.strokeStyle = 'rgba(0, 0, 0, 1)';

        if (this.isActivelyErasing) {
            // A round eraser, rubbing the tunnels back out.
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(coords.x, coords.y, brush / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
        } else if (this.lastDrawX >= 0) {
            ctx.lineWidth = brush;
            ctx.lineCap = 'square';
            ctx.beginPath();
            ctx.moveTo(this.lastDrawX, this.lastDrawY);
            ctx.lineTo(coords.x, coords.y);
            ctx.stroke();
        } else {
            ctx.fillRect(coords.x - brush / 2, coords.y - brush / 2, brush, brush);
        }

        this.lastDrawX = coords.x;
        this.lastDrawY = coords.y;
    }

    private showDrawingToolbar() {
        this.drawingToolbarEl?.remove();
        const viewport = this.viewport;
        if (!viewport) return;

        const toolbar = viewport.createDiv('drawing-toolbar');
        this.drawingToolbarEl = toolbar;
        const row = toolbar.createDiv('drawing-toolbar-row');

        const tools: { glyph: string; label: string; onClick: () => void }[] = [
            { glyph: '✎', label: 'Drawing mode', onClick: () => this.selectTool(false) },
            { glyph: '◇', label: 'Eraser', onClick: () => this.selectTool(true) },
            { glyph: '⌫', label: 'Clear canvas', onClick: () => this.clearDrawing() },
            { glyph: '✕', label: 'Exit drawing mode', onClick: () => this.exitDrawingMode() },
        ];
        for (const tool of tools) {
            const btn = row.createEl('button', { cls: 'drawing-toolbar-btn', text: tool.glyph, attr: { type: 'button' } });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                tool.onClick();
            });
            btn.addEventListener('mouseenter', () => this.setToolbarLabel(tool.label));
            btn.addEventListener('mouseleave', () => this.setToolbarLabel());
        }

        toolbar.createDiv({ cls: 'drawing-toolbar-label', text: 'Drawing mode' });
        this.updateToolbarUI();
    }

    private selectTool(eraser: boolean) {
        this.selectedToolEraser = eraser;
        this.updateToolbarUI();
    }

    private clearDrawing() {
        const ctx = this.wormTrailCanvas?.getContext('2d');
        if (ctx && this.wormTrailCanvas) ctx.clearRect(0, 0, this.wormTrailCanvas.width, this.wormTrailCanvas.height);
    }

    /** The label under the buttons: what the pointer is over, or the tool in hand. */
    private setToolbarLabel(text = this.selectedToolEraser ? 'Eraser' : 'Drawing mode') {
        const label = this.drawingToolbarEl?.querySelector('.drawing-toolbar-label');
        if (label) label.setText(text);
    }

    private updateToolbarUI() {
        const btns = this.drawingToolbarEl?.querySelectorAll('.drawing-toolbar-btn');
        btns?.[0]?.toggleClass('is-active', !this.selectedToolEraser);
        btns?.[1]?.toggleClass('is-active', this.selectedToolEraser);
        this.setToolbarLabel();
        this.viewport?.toggleClass('is-erasing', this.selectedToolEraser);
    }

    private _viewportObserver: ResizeObserver | null = null;

    async onClose() {
        this.removeShortcuts();
        this._viewportObserver?.disconnect();
        this._viewportObserver = null;
        this.cancelSettle();
        this.saveViewStateNow();

        this.stopFireflies();
        this.stopShootingStars();
        this.stopAnt();
        this.stopWorm();
        this._renderDebounce = stop(this._renderDebounce);
        this._skyUpdateInterval = stop(this._skyUpdateInterval);

        for (const [type, fn] of [
            ['mousemove', this.handleKanbanMouseMove],
            ['mouseup', this.handleKanbanMouseUp],
            ['mousemove', this.handleMouseMove],
            ['mouseup', this.handleMouseUp],
        ] as [string, EventListener][]) {
            window.removeEventListener(type, fn);
        }

        const viewport = this.viewport;
        if (!viewport) return;
        for (const [type, fn] of [
            ['mousedown', this.handleMouseDown],
            ['wheel', this.handleWheel],
            ['touchstart', this.handleTouchStart],
            ['touchmove', this.handleTouchMove],
            ['touchend', this.handleTouchEnd],
            ['touchcancel', this.handleTouchEnd],
        ] as [string, EventListener][]) {
            viewport.removeEventListener(type, fn);
        }
    }



    // --- Kanban Panning ---
    private handleKanbanMouseDown = (e: MouseEvent) => {
        const container = e.currentTarget as HTMLElement;
        
        // Middle mouse (button 1) pans EVERYWHERE.
        const isMiddle = e.button === 1;
        
        // Check if we clicked on an actual interactive element
        const interactable = (e.target as HTMLElement).closest(
            '.garden-item, .seed-content, .zone-add-btn, .add-column-btn, .column-drag-handle'
        );
        
        // Left mouse (button 0) pans only if NOT interactable
        const isLeftEmpty = e.button === 0 && !interactable;

        if (isMiddle || isLeftEmpty) {
            e.preventDefault();
            this.clearSelection(); // Clear multi-selection when clicking empty space
            this.isPanningKanban = true;
            this.kanbanStartX = e.clientX;
            this.kanbanStartY = e.clientY;
            this.kanbanScrollLeft = container.scrollLeft;
            this.kanbanScrollTop = container.scrollTop;
            container.setCssStyles({ cursor: 'grabbing', userSelect: 'none' });

            window.addEventListener('mousemove', this.handleKanbanMouseMove);
            window.addEventListener('mouseup', this.handleKanbanMouseUp);
        }
    };

    private handleKanbanMouseMove = (e: MouseEvent) => {
        if (!this.isPanningKanban) return;
        const container = this.containerEl.querySelector<HTMLElement>('.kanban-scroll-container');
        if (!container) return;

        const dx = e.clientX - this.kanbanStartX;
        const dy = e.clientY - this.kanbanStartY;
        
        container.scrollLeft = this.kanbanScrollLeft - dx;
        container.scrollTop = this.kanbanScrollTop - dy;
    };

    private handleKanbanMouseUp = () => {
        if (!this.isPanningKanban) return;
        this.isPanningKanban = false;
        const container = this.containerEl.querySelector<HTMLElement>('.kanban-scroll-container');
        if (container) {
            container.setCssStyles({ cursor: '', userSelect: '' });
        }
        window.removeEventListener('mousemove', this.handleKanbanMouseMove);
        window.removeEventListener('mouseup', this.handleKanbanMouseUp);
        
        this.scheduleViewStateSave(); 
    };
    private handleMouseDown = (e: MouseEvent) => {
        // Working in a plant's card: keep it open, and do not pan the garden under it.
        if (this.inPeek(e.target)) {
            this.pinPeek();
            return;
        }
        // Middle mouse pans even in drawing mode!
        if (this.isDrawingMode && e.button !== 1) return; 
        
        const isMiddle = e.button === 1;
        this._mouseDownAt = { x: e.clientX, y: e.clientY };
        const target = e.target as HTMLElement;
        // Check if we clicked a plant part or interactable element
        const isInteractable = target.closest('[data-item-id]');
        
        // Middle mouse pans EVERYWHERE. Left mouse pans only on empty space.
        if (isMiddle || (e.button === 0 && !isInteractable)) {
            e.preventDefault();
            this.isDragging = true;
            this.cancelSettle();
            const world = this.world;
            const vp = this.viewport;
            const b = world && vp ? this.cameraBounds(world, vp) : null;
            this.startX = e.clientX - (b ? this.rawAxis(this.currentTranslateX, b.x) : this.currentTranslateX);
            this.startY = e.clientY - (b ? this.rawAxis(this.currentTranslateY, b.y) : this.currentTranslateY);
            vp?.addClass('is-panning');
        }
    };

    private handleMouseMove = (e: MouseEvent) => {
        // Drawing on canvas
        if (this.isDrawingMode && this.isCurrentlyDrawing) {
            this.drawOnCanvas(e);
            return;
        }
        if (!this.isDragging) return;
        e.preventDefault();

        const viewport = this.viewport;
        const world = this.world;
        if (!viewport || !world) return;

        const b = this.cameraBounds(world, viewport);
        this.currentTranslateX = this.softAxis(e.clientX - this.startX, b.x);
        this.currentTranslateY = this.softAxis(e.clientY - this.startY, b.y);
        this.applyWorldTransform(world, viewport);
    };

    private handleMouseUp = () => {
        const viewport = this.viewport;
        if (this.isDragging) {
            this.isDragging = false;
            viewport?.removeClass('is-panning');
            this.settleCamera();
        }
        if (this.isDrawingMode && this.isCurrentlyDrawing) {
            this.isCurrentlyDrawing = false;
            this.isActivelyErasing = false;
            // The stroke is over: back to the cursor of the tool in hand.
            viewport?.toggleClass('is-erasing', this.selectedToolEraser);
        }
    };

    private handleWheel = (e: WheelEvent) => {
        if (this.inPeek(e.target)) return;
        const viewport = this.viewport;
        const world = this.world;
        if (!viewport || !world) return;
        // A wheel has no release, so the camera settles once it goes quiet.
        this.cancelSettle();
        this._settleTimeout = window.setTimeout(() => this.settleCamera(), 140);

        if (e.ctrlKey || e.metaKey) {
            // --- ZOOM ---
            e.preventDefault();
            const delta = -e.deltaY * 0.005;
            const newZoom = Math.max(this.minZoomFor(world, viewport), Math.min(this.zoomMax, this.zoom + delta));

            // Zoom toward cursor position (Standard 2D camera math)
            const rect = viewport.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;

            // Calculate the world coordinates currently under the cursor
            const worldX = (cursorX - this.currentTranslateX) / this.zoom;
            const worldY = (cursorY - this.currentTranslateY) / this.zoom;

            // Adjust translate to keep those coordinates under the cursor at the new zoom
            this.currentTranslateX = cursorX - (worldX * newZoom);
            this.currentTranslateY = cursorY - (worldY * newZoom);

            this.zoom = newZoom;
            this.applyWorldTransform(world, viewport);
            this.scheduleViewStateSave(); 
        } else {
            // --- PAN VERTICALLY (and horizontally if no horizontal scrollbar) ---
            e.preventDefault();
            const b = this.cameraBounds(world, viewport);
            this.currentTranslateX = this.softAxis(this.rawAxis(this.currentTranslateX, b.x) - e.deltaX, b.x);
            this.currentTranslateY = this.softAxis(this.rawAxis(this.currentTranslateY, b.y) - e.deltaY, b.y);
            this.applyWorldTransform(world, viewport);
        }
    };




    /**
     * Aim the camera at one plant so it fills the viewport: as wide as one
     * plant slot, or smaller when the plant is tall or deep. Used by the popup;
     * does nothing while there is nothing to show.
     */
    focusProject(index: number) {
        const viewport = this.viewport;
        const world = this.world;
        const count = this.app.gardenData.length;
        if (!viewport || !world || count === 0) return;
        const i = Math.max(0, Math.min(count - 1, index));
        const project = this.app.gardenData[i];
        const vw = viewport.offsetWidth || 320;
        const vh = viewport.offsetHeight || 320;
        const extents = this.calculateProjectExtents(project);
        const margin = 42;
        // Leave more of the scene around a focused plant. The popup used to zoom
        // tiny seedlings until they filled nearly the whole window.
        const horizon = 0.64;
        const above = extents.aboveHeight + margin;
        const below = Math.max(extents.undergroundDepth, 40) + margin;
        // Width: the sprite itself (renderPlantSprite leaves it on the wrapper) plus room on each side.
        const wrapper = this.contentEl.querySelector<HTMLElement>(`.garden-plant-wrapper[data-project-id="${project.id}"]`);
        const spriteWidth = Number(wrapper?.dataset.width) || STEM_ORIGIN_WIDTH * PIXEL_SCALE;
        const widthBasis = Math.max(spriteWidth + 2 * margin, 300);
        const fit = Math.min(vw / widthBasis, (vh * horizon) / above, (vh * (1 - horizon)) / below);
        // A little breathing room after fitting keeps the focused plant contextual.
        const comfortableFit = fit * 0.84;
        this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, 0.9, comfortableFit));
        this.currentTranslateX = vw / 2 - plantCentre(i) * this.zoom;
        this.currentTranslateY = vh * horizon - this._dynamicGroundLineY * this.zoom;
        this.applyWorldTransform(world, viewport);
        this.settleCamera(false);
        this.scheduleViewStateSave();
    }

    /** The two elements the camera works on. Null between renders. */
    private get viewport(): HTMLElement | null {
        return this.contentEl.querySelector('.garden-canvas-viewport');
    }

    private get world(): HTMLElement | null {
        return this.contentEl.querySelector('.garden-world');
    }

    /** The furthest out the camera goes: the garden fills the pane's height. */
    private minZoomFor(world: HTMLElement, viewport: HTMLElement): number {
        const fill = viewport.offsetHeight / (world.offsetHeight || 1);
        return Math.min(this.zoomMax, Math.max(this.zoomMin, fill));
    }

    /** The translate range that keeps the garden filling the pane, per axis. */
    private cameraBounds(world: HTMLElement, viewport: HTMLElement, zoom = this.zoom) {
        const axis = (view: number, size: number) => {
            const min = view - size * zoom;
            // Zoomed out past the garden: hold it centred.
            return min > 0 ? { min: min / 2, max: min / 2 } : { min, max: 0 };
        };
        return {
            x: axis(viewport.offsetWidth, world.offsetWidth),
            y: axis(viewport.offsetHeight, world.offsetHeight),
        };
    }

    /** A raw position past an edge, stretched: it gives less the further it goes. */
    private softAxis(raw: number, b: { min: number; max: number }): number {
        const stretch = (o: number) => RUBBER_REACH * (1 - 1 / (o / RUBBER_REACH + 1));
        if (raw < b.min) return b.min - stretch(b.min - raw);
        if (raw > b.max) return b.max + stretch(raw - b.max);
        return raw;
    }

    /** The inverse of softAxis: where the finger would be for a stretched position. */
    private rawAxis(shown: number, b: { min: number; max: number }): number {
        const unstretch = (r: number) => RUBBER_REACH * (1 / (1 - Math.min(r, RUBBER_REACH - 1) / RUBBER_REACH) - 1);
        if (shown < b.min) return b.min - unstretch(b.min - shown);
        if (shown > b.max) return b.max + unstretch(shown - b.max);
        return shown;
    }

    private _mouseDownAt: { x: number; y: number } | null = null;
    private _settleFrame = 0;
    private _settleTimeout: number | null = null;

    private cancelSettle() {
        if (this._settleFrame) cancelAnimationFrame(this._settleFrame);
        this._settleFrame = 0;
        if (this._settleTimeout) window.clearTimeout(this._settleTimeout);
        this._settleTimeout = null;
    }

    /** Bring the camera back inside the garden: eased after a gesture, at once otherwise. */
    private settleCamera(animate = true) {
        const viewport = this.viewport;
        const world = this.world;
        if (!viewport || !world || !viewport.offsetWidth) return;
        this.cancelSettle();
        const floor = this.minZoomFor(world, viewport);
        if (this.zoom < floor) {
            const cx = viewport.offsetWidth / 2, cy = viewport.offsetHeight / 2;
            this.currentTranslateX = cx - ((cx - this.currentTranslateX) / this.zoom) * floor;
            this.currentTranslateY = cy - ((cy - this.currentTranslateY) / this.zoom) * floor;
            this.zoom = floor;
            this.applyWorldTransform(world, viewport);
        }
        const b = this.cameraBounds(world, viewport);
        const toX = Math.min(b.x.max, Math.max(b.x.min, this.currentTranslateX));
        const toY = Math.min(b.y.max, Math.max(b.y.min, this.currentTranslateY));
        if (toX === this.currentTranslateX && toY === this.currentTranslateY) return;
        if (!animate) {
            this.currentTranslateX = toX;
            this.currentTranslateY = toY;
            this.applyWorldTransform(world, viewport);
            return;
        }
        const fromX = this.currentTranslateX, fromY = this.currentTranslateY;
        const start = performance.now();
        const step = (now: number) => {
            const t = Math.min(1, (now - start) / 260);
            const e = 1 - Math.pow(1 - t, 3);
            this.currentTranslateX = fromX + (toX - fromX) * e;
            this.currentTranslateY = fromY + (toY - fromY) * e;
            this.applyWorldTransform(world, viewport);
            this._settleFrame = t < 1 ? window.requestAnimationFrame(step) : 0;
            if (t === 1) this.scheduleViewStateSave();
        };
        this._settleFrame = window.requestAnimationFrame(step);
    }


    // --- Peeking at a plant with the board hidden ---
    // With the board out of the way, hovering a plant (or tapping it) floats its
    // card over the garden. The card is read-only and sits on top of the scene:
    // the camera, the plants and the layout stay exactly where they are.

    private _peekEl: HTMLElement | null = null;
    private _peekProjectId: string | null = null;
    private _peekPinned = false;
    private _peekPinnedId: string | null = null;
    private _peekHoverTimer: number | null = null;
    private _peekHoverProjectId: string | null = null;
    private _touchTap: { x: number; y: number; t: number } | null = null;

    /**
     * Right-click in the garden: on a plant's part, that cell's menu; anywhere else
     * on a plant, the plant's own menu. The same menus as on the board, opened where
     * the pointer is, so they work with the board hidden too.
     */
    private handleGardenContextMenu = (e: MouseEvent) => {
        if (this.isDrawingMode || this.inPeek(e.target)) return;
        e.preventDefault();
        this.hidePeek();
        const forward = (target: Element | null) => {
            if (!target) return false;
            target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: false, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 2 }));
            return true;
        };
        const part = (e.target as HTMLElement).closest<HTMLElement>('[data-item-id]');
        const itemId = part?.dataset.itemId;
        if (itemId && forward(this.shownEl(`.garden-item[data-id="${itemId}"]`))) return;
        const hit = this.plantAt(e.clientX, e.clientY);
        if (hit) forward(this.contentEl.querySelector(`.project-column[data-project-id="${hit.project.id}"] .seed-content`));
    };

    private boardHidden(): boolean {
        return document.documentElement.dataset.board === 'hidden';
    }

    /** The plant under a point in the viewport, if the point is on it. */
    private plantAt(clientX: number, clientY: number): { project: ProjectData; x: number; top: number } | null {
        const viewport = this.viewport;
        if (!viewport) return null;
        const rect = viewport.getBoundingClientRect();
        const wx = (clientX - rect.left - this.currentTranslateX) / this.zoom;
        const wy = (clientY - rect.top - this.currentTranslateY) / this.zoom;
        const index = Math.round((wx - WORLD_PADDING - PLANT_SPACING / 2) / PLANT_SPACING);
        const project = this.app.gardenData[index];
        if (!project || Math.abs(wx - plantCentre(index)) > PLANT_SPACING * 0.3) return null;
        const extents = this.calculateProjectExtents(project);
        const ground = this._dynamicGroundLineY;
        if (wy < ground - extents.aboveHeight - 60 || wy > ground + extents.undergroundDepth + 60) return null;
        return this.plantHit(index);
    }

    private showPeek(hit: { project: ProjectData; x: number; top: number }) {
        const viewport = this.viewport;
        if (!viewport) return;
        if (!this._peekEl || !this._peekEl.isConnected) {
            this._peekEl = viewport.createDiv('garden-peek-card');
            this._peekProjectId = null;
        }
        const card = this._peekEl;
        if (this._peekProjectId !== hit.project.id) {
            this._peekProjectId = hit.project.id;
            card.empty();
            // The board's own card for this plant: add, write, edit, drag and the
            // menus all work in it, the same as on the board.
            this.createProjectColumn(card, hit.project);
        }
        // Keep the card visually attached to the plant instead of merely sharing its
        // top edge. Its seed row lines up with the soil line, and the card chooses the
        // side with enough room so it reads as that plant's board rather than a random
        // floating panel.
        const rect = viewport.getBoundingClientRect();
        const vw = viewport.offsetWidth, vh = viewport.offsetHeight;
        const w = card.offsetWidth || 230, h = card.offsetHeight || 120;
        let plantLeft = hit.x, plantRight = hit.x;
        const wrapper = this.contentEl.querySelector(`.garden-plant-wrapper[data-project-id="${hit.project.id}"]`);
        if (wrapper) {
            let found = false;
            for (const part of Array.from(wrapper.querySelectorAll('*'))) {
                const r = part.getBoundingClientRect();
                if (r.width === 0 || r.height === 0 || r.top - rect.top > this.currentTranslateY + this._dynamicGroundLineY * this.zoom) continue;
                plantLeft = found ? Math.min(plantLeft, r.left - rect.left) : r.left - rect.left;
                plantRight = found ? Math.max(plantRight, r.right - rect.left) : r.right - rect.left;
                found = true;
            }
        }

        const gap = 14;
        const right = plantRight + gap;
        const leftOfPlant = plantLeft - gap - w;
        const roomRight = vw - plantRight;
        const roomLeft = plantLeft;
        const useLeft = right + w > vw - 8 && (leftOfPlant >= 8 || roomLeft > roomRight);
        const left = useLeft
            ? Math.max(8, Math.min(vw - w - 8, leftOfPlant))
            : Math.max(8, Math.min(vw - w - 8, right));

        const seed = card.querySelector<HTMLElement>('.seed-cell');
        const seedCenter = seed ? seed.offsetTop + seed.offsetHeight / 2 : h / 2;
        const soilY = this.currentTranslateY + this._dynamicGroundLineY * this.zoom;
        const top = Math.max(8, Math.min(vh - h - 8, soilY - seedCenter));

        card.dataset.peekSide = useLeft ? 'left' : 'right';
        // Appearing: jump straight to the spot. Already shown: glide there.
        const wasVisible = card.hasClass('is-visible');
        card.toggleClass('is-gliding', wasVisible);
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
        card.addClass('is-visible');
    }

    private cancelPeekHover() {
        if (this._peekHoverTimer !== null) window.clearTimeout(this._peekHoverTimer);
        this._peekHoverTimer = null;
        this._peekHoverProjectId = null;
    }

    /** Hover intent: a plant must be held for a beat before its board appears. */
    private schedulePeek(hit: { project: ProjectData; x: number; top: number }) {
        if (this._peekEl?.hasClass('is-visible') && this._peekProjectId === hit.project.id) return;
        if (this._peekHoverTimer !== null && this._peekHoverProjectId === hit.project.id) return;
        this.cancelPeekHover();
        this._peekHoverProjectId = hit.project.id;
        this._peekHoverTimer = window.setTimeout(() => {
            this._peekHoverTimer = null;
            this._peekHoverProjectId = null;
            if (this.boardHidden() && !this._peekPinned) this.showPeek(hit);
        }, 280);
    }

    private hidePeek() {
        this.cancelPeekHover();
        this._peekPinned = false;
        this._peekEl?.removeClass('is-visible');
    }

    /** Keep the open card open, across re-renders too. */
    private pinPeek() {
        this._peekPinned = true;
        this._peekPinnedId = this._peekProjectId;
    }

    private inPeek(target: EventTarget | null): boolean {
        return !!this._peekEl && target instanceof Node && this._peekEl.contains(target);
    }

    /** Where plant `index` stands on screen: its centre and its top, for placing its card. */
    private plantHit(index: number): { project: ProjectData; x: number; top: number } {
        const project = this.app.gardenData[index];
        const extents = this.calculateProjectExtents(project);
        return {
            project,
            x: this.currentTranslateX + plantCentre(index) * this.zoom,
            top: this.currentTranslateY + (this._dynamicGroundLineY - extents.aboveHeight - 20) * this.zoom,
        };
    }

    /** After a re-render, bring back the card that was being worked in, without fading. */
    private restorePeek() {
        const id = this._peekPinnedId;
        if (!this._peekPinned || !id || !this.boardHidden()) return;
        const index = this.app.gardenData.findIndex(p => p.id === id);
        if (index === -1) {
            this._peekPinned = false;
            return;
        }
        this._peekEl = null;
        this.showPeek(this.plantHit(index));
        (this._peekEl as HTMLElement | null)?.addClass('is-instant');
        this._peekPinned = true;
        const win = this.containerEl.ownerDocument.defaultView || window;
        win.requestAnimationFrame(() => win.requestAnimationFrame(() => this._peekEl?.removeClass('is-instant')));
    }

    /** The element for a selector, preferring one that is on screen (the card over the board). */
    private shownEl(selector: string): HTMLElement | null {
        const all = Array.from(this.contentEl.querySelectorAll<HTMLElement>(selector));
        return all.find(el => el.getClientRects().length > 0) ?? all[0] ?? null;
    }

    private handlePeekMove = (e: MouseEvent) => {
        if (!this.boardHidden() || this.isDragging || this._peekPinned || this.inPeek(e.target)) return;
        const hit = this.plantAt(e.clientX, e.clientY);
        if (hit) this.schedulePeek(hit);
        else this.hidePeek();
    };

    private handlePeekLeave = () => {
        if (!this._peekPinned) this.hidePeek();
    };

    /** A tap (touch or a click without a drag) pins the card, a tap elsewhere lets it go. */
    private peekTap(clientX: number, clientY: number, target: EventTarget | null = null) {
        if (!this.boardHidden() || this.inPeek(target)) return;
        const hit = this.plantAt(clientX, clientY);
        if (hit) {
            this.cancelPeekHover();
            this.showPeek(hit);
            this.pinPeek();
        } else {
            this.hidePeek();
        }
    }

    private applyWorldTransform(world: HTMLElement, viewport: HTMLElement) {
        // Standard 2D camera math: origin at top-left makes centering predictable
        if (!this._peekPinned) this.cancelPeekHover();
        if (this._peekEl && !this._peekPinned) this._peekEl.removeClass('is-visible');
        world.setCssStyles({ transformOrigin: '0 0' });
        world.style.transform = `translate(${this.currentTranslateX}px, ${this.currentTranslateY}px) scale(${this.zoom})`;
    }

    // --- Scroll Position Preservation ---
    saveScrollPositions(): { scrollTop: number; selectors: { selector: string; scrollTop: number; scrollLeft: number }[] } {
        const selectors = ['.kanban-scroll-container', '.kanban-list', '.seed-content', '.column-body'];
        const entries: { selector: string; scrollTop: number; scrollLeft: number }[] = [];

        for (const selector of selectors) {
            this.containerEl.querySelectorAll(selector).forEach((el, i) => {
                const htmlEl = el as HTMLElement;
                entries.push({ selector: `${selector}[${i}]`, scrollTop: htmlEl.scrollTop, scrollLeft: htmlEl.scrollLeft });
            });
        }

        return { scrollTop: 0, selectors: entries };
    }

    restoreScrollPositions(states: { scrollTop: number; selectors: { selector: string; scrollTop: number; scrollLeft: number }[] }) {
        const apply = () => {
            for (const entry of states.selectors) {
                const match = entry.selector.match(/^(.+)\[(\d+)\]$/);
                if (!match) continue;
                const els = this.containerEl.querySelectorAll(match[1]);
                const htmlEl = els[parseInt(match[2])] as HTMLElement | undefined;
                if (!htmlEl) continue;
                if (htmlEl.scrollTop !== entry.scrollTop) htmlEl.scrollTop = entry.scrollTop;
                if (htmlEl.scrollLeft !== entry.scrollLeft) htmlEl.scrollLeft = entry.scrollLeft;
            }
        };
        // At once, before the swapped-in board paints, or it shows at the top for a
        // frame and jumps back. Again after two frames for anything still settling.
        apply();
        const win = this.containerEl.ownerDocument.defaultView || window;
        win.requestAnimationFrame(() => win.requestAnimationFrame(apply));
    }

    async renderGarden(container: HTMLElement) {

        container.empty();
        const splitContainer = container.createDiv("garden-split-container");

        const canvasParent = splitContainer.createDiv("garden-canvas-area");
        canvasParent.setCssProps({ '--garden-canvas-flex': `0 0 ${this._splitRatio * 100}%` });
        await this.renderGardenCanvas(canvasParent);

        const resizer = splitContainer.createDiv("garden-resizer");
        const bottomHalf = splitContainer.createDiv("garden-bottom-half");

        // --- Resizer Drag Logic ---
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            resizer.addClass('is-dragging');
            document.body.setCssStyles({ cursor: 'row-resize', userSelect: 'none' }); // Prevent text highlighting while dragging

            const onMouseMove = (ev: MouseEvent) => {
                const rect = splitContainer.getBoundingClientRect();
                // Calculate mouse position relative to the container
                let y = ev.clientY - rect.top;
                
                // Clamp values so neither pane gets completely squished
                y = Math.max(100, Math.min(rect.height - 100, y));
                
                // Apply explicit pixel heights instead of flex
                canvasParent.setCssProps({ '--garden-canvas-flex': `0 0 ${y}px` });
                bottomHalf.setCssProps({ '--garden-board-flex': `0 0 ${rect.height - y - 4}px` }); // -4 for the resizer height
            };

            const onMouseUp = () => {
                resizer.removeClass('is-dragging');
                document.body.setCssStyles({ cursor: '', userSelect: '' });
                // Save the split ratio so it persists across re-renders
                const rect = splitContainer.getBoundingClientRect();
                const canvasHeight = canvasParent.getBoundingClientRect().height;
                this._splitRatio = canvasHeight / rect.height;
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });

        const scrollContainer = bottomHalf.createDiv("kanban-scroll-container");
        
        // Attach the pan listener
        scrollContainer.addEventListener('mousedown', this.handleKanbanMouseDown);
        scrollContainer.addEventListener('auxclick', (e) => e.preventDefault()); // Prevent middle-click autoscroll bug

        const addLeftBtn = scrollContainer.createEl('button', {
            cls: "add-column-btn",
            attr: { type: 'button', 'aria-label': 'Add plant on the left' },
        });
        addLeftBtn.createDiv({ cls: "add-column-btn-inner", text: "+" });
        addLeftBtn.onclick = () => this.createNewProject('left');

        if (this.app.gardenData.length === 0) {
            // The + buttons then fill the height, so they sit centred.
            scrollContainer.addClass("is-empty");
            const emptyMsg = scrollContainer.createDiv("kanban-empty-message");
            emptyMsg.createEl("h3", { text: "Your garden is empty" });
            emptyMsg.createEl("p", { text: "Click + to plant your first seed!" });
        } else {
            this.app.gardenData.forEach(project => {
                if (project && project.stem && project.flowers) {
                    this.createProjectColumn(scrollContainer, project);
                }
            });

            
            
        }

        const addRightBtn = scrollContainer.createEl('button', {
            cls: "add-column-btn",
            attr: { type: 'button', 'aria-label': 'Add plant on the right' },
        });
        addRightBtn.createDiv({ cls: "add-column-btn-inner", text: "+" });
        addRightBtn.onclick = () => this.createNewProject('right');

        this.syncKanbanSeedLine(scrollContainer);
        // Text wrapping/font metrics can settle one frame later (especially on iOS).
        // Re-anchor once more after layout so the seed horizon is exact.
        (this.containerEl.ownerDocument.defaultView || window).requestAnimationFrame(() => {
            if (scrollContainer.isConnected) this.syncKanbanSeedLine(scrollContainer);
        });

        Sortable.create(scrollContainer, {
            animation: 150,
            // Touch: hold to pick up, so a swipe still scrolls the board.
            delay: 250,
            delayOnTouchOnly: true,
            touchStartThreshold: 6,
            ghostClass: 'sortable-column-ghost',
            handle: '.column-drag-handle',
            filter: '.add-column-btn',
            onEnd: (evt: SortableEvent) => void this.handleColumnDrop(evt)
        });
    }



    
    /**
     * A kanban column is the plant abstracted into blocks:
     *
     *   Flowers / Stem  grow upward
     *   Seed            is the shared horizon
     *   Roots / Minerals grow downward
     *
     * Do not stretch the short plant's top stack to match a tall neighbour. That
     * creates the "blocks floating in the air" gap. Instead move the whole short
     * card down by exactly the difference between its natural above-ground height
     * and the tallest one. The blocks stay magnetically packed while every seed
     * lands on the same horizontal line.
     */
    private syncKanbanSeedLine(scrollContainer: HTMLElement) {
        const columns = Array.from(scrollContainer.querySelectorAll<HTMLElement>(':scope > .project-column'));
        if (columns.length === 0) {
            scrollContainer.setCssProps({ '--kanban-seed-offset': '' });
            return;
        }

        // Clear our previous offsets before measuring natural card heights.
        for (const column of columns) column.setCssStyles({ marginTop: '' });

        const above = columns.map(column => {
            const top = column.querySelector<HTMLElement>('.column-top-half');
            return { column, height: top?.getBoundingClientRect().height ?? 0 };
        });
        const tallestAbove = Math.max(0, ...above.map(({ height }) => height));

        for (const { column, height } of above) {
            column.setCssStyles({ marginTop: `${Math.max(0, tallestAbove - height)}px` });
        }

        const win = this.containerEl.ownerDocument.defaultView || window;
        const columnPaddingTop = parseFloat(win.getComputedStyle(columns[0]).paddingTop) || 0;
        scrollContainer.setCssProps({ '--kanban-seed-offset': `${columnPaddingTop + tallestAbove}px` });
    }


    private async renderGardenCanvas(parent: HTMLElement) {
        // The old pane's watcher would fire as it leaves, against this world half built.
        this._viewportObserver?.disconnect();
        this._viewportObserver = null;
        const viewport = parent.createDiv("garden-canvas-viewport");
        const world = viewport.createDiv("garden-world");

        const calculatedWidth = Math.max(600, this.app.gardenData.length * PLANT_SPACING + WORLD_PADDING * 2);
        world.style.width = `${calculatedWidth}px`;

        // The backdrops are measured before they are laid out: each is drawn at its
        // own size times PIXEL_SCALE, so the scene keeps its pixel grid.
        const [bgImg, cloudImg] = await Promise.all([loadImage(bgImageUrl), loadImage(cloudUrl)]);
        const bgScaledH = Math.round(bgImg.naturalHeight * PIXEL_SCALE);
        const cloudScaledH = Math.round(cloudImg.naturalHeight * PIXEL_SCALE);
        const cloudScaledW = Math.round(cloudImg.naturalWidth * PIXEL_SCALE);

        // --- Sky and ground grow to fit the tallest plant and the deepest roots ---
        let maxAbove = 0;
        let maxUnderground = 0;
        for (const project of this.app.gardenData) {
            const extents = this.calculateProjectExtents(project);
            maxAbove = Math.max(maxAbove, extents.aboveHeight);
            maxUnderground = Math.max(maxUnderground, extents.undergroundDepth);
        }

        // The sky never drops below BASE_SKY, the ground never below BASE_GROUND,
        // so a garden of seedlings still stands in a world with room around it.
        const skyHeight = Math.max(maxAbove + 208, BASE_SKY);
        const groundHeight = Math.max(maxUnderground + 160, BASE_GROUND);
        this._dynamicGroundLineY = skyHeight;
        world.style.height = `${skyHeight + groundHeight}px`;
        // Every layer's placement is written against these two (see styles.css).
        world.style.setProperty('--sky', `${skyHeight}px`);
        world.style.setProperty('--ground', `${groundHeight}px`);

        const { skyColor, starOpacity } = this.getDayNightState();

        const skyColorLayer = world.createDiv("garden-sky-color-layer");
        skyColorLayer.style.backgroundColor = skyColor;

        // The stars canvas is one screen pixel per art pixel; CSS scales it up.
        const shootingStarLayer = world.createDiv("garden-shooting-star-layer");
        const ssCanvas = shootingStarLayer.createEl('canvas');
        ssCanvas.width = Math.floor(calculatedWidth / PIXEL_SCALE);
        ssCanvas.height = Math.floor(skyHeight / PIXEL_SCALE);
        this.shootingStarCanvas = ssCanvas;

        // Satellites are elements, not canvas, so they move smoothly.
        this.satelliteLayer = world.createDiv("garden-satellite-layer");

        const starsLayer = world.createDiv("garden-stars-layer");
        starsLayer.style.opacity = String(starOpacity);
        const starsImg = await loadImage(starsPatternUrl);
        starsLayer.style.backgroundImage = `url(${starsPatternUrl})`;
        starsLayer.style.backgroundSize = `${Math.round(starsImg.naturalWidth * PIXEL_SCALE)}px ${Math.round(starsImg.naturalHeight * PIXEL_SCALE)}px`;

        const mountainsImg = await loadImage(mountainsUrl);
        const mountainsLayer = world.createDiv("garden-mountains-layer");
        mountainsLayer.style.backgroundImage = `url(${mountainsUrl})`;
        mountainsLayer.style.backgroundSize = `auto ${Math.round(mountainsImg.naturalHeight * PIXEL_SCALE)}px`;

        const cloudLayer = world.createDiv("garden-cloud-layer");
        cloudLayer.style.backgroundImage = `url(${cloudUrl})`;
        cloudLayer.style.backgroundSize = `${cloudScaledW}px ${cloudScaledH}px`;
        cloudLayer.style.animation = `garden-cloud-scroll ${CLOUD_SCROLL_DURATION}s linear infinite`;
        // The keyframes scroll by the cloud's own width.
        cloudLayer.setCssProps({ '--garden-cloud-width': `${cloudScaledW}px` });

        const bgLayer = world.createDiv("garden-bg-layer");
        bgLayer.style.backgroundImage = `url(${bgImageUrl})`;
        bgLayer.style.backgroundSize = `auto ${bgScaledH}px`;

        const groundLayer = world.createDiv("garden-ground-layer");
        const tile = Math.round(STEM_ORIGIN_WIDTH * PIXEL_SCALE / 3);
        groundLayer.style.backgroundImage = `url(${groundUrl})`;
        groundLayer.style.backgroundSize = `${tile}px ${tile}px`;

        // The worm's tunnels, and whatever anyone drew: the ground only.
        const trailLayer = world.createDiv("garden-worm-trail-layer");
        const trailCanvas = trailLayer.createEl('canvas');
        trailCanvas.width = calculatedWidth;
        trailCanvas.height = groundHeight;
        this.wormTrailCanvas = trailCanvas;

        const wormLayer = world.createDiv("garden-worm-layer");
        const plantsLayer = world.createDiv("garden-plants-layer");

        const fireflyLayer = world.createDiv("garden-firefly-layer");
        const night = starOpacity > 0.1;
        fireflyLayer.style.setProperty('--firefly-color', night ? '#7eb357' : '#5e7e50');
        fireflyLayer.style.setProperty('--glow-opacity', String(starOpacity));
        this.createFireflies(fireflyLayer, skyHeight);

        // The sky drifts through the day; a minute's resolution is plenty.
        this._skyUpdateInterval = window.setInterval(() => {
            const state = this.getDayNightState();
            skyColorLayer.style.backgroundColor = state.skyColor;
            starsLayer.style.opacity = String(state.starOpacity);
            fireflyLayer.style.setProperty('--glow-opacity', String(state.starOpacity));
            fireflyLayer.style.setProperty('--firefly-color', state.starOpacity > 0.1 ? '#7eb357' : '#5e7e50');
        }, 60000);

        // --- The ant walks the horizon ---
        const antEl = plantsLayer.createDiv("garden-ant");
        antEl.style.backgroundImage = `url(${ant1Url})`;
        antEl.style.bottom = `${groundHeight}px`;
        void loadImage(ant1Url).then((img) => {
            antEl.style.width = `${img.naturalWidth * PIXEL_SCALE}px`;
            antEl.style.height = `${img.naturalHeight * PIXEL_SCALE}px`;
        });

        this.createWormElements(wormLayer);

        // A plant stands in the middle of its slot, its top-left on the horizon:
        // renderPlantSprite grows the sprite up and down from there.
        this.app.gardenData.forEach((project, i) => {
            const wrapper = plantsLayer.createDiv("garden-plant-wrapper");
            wrapper.dataset.projectId = project.id;
            wrapper.style.left = `${WORLD_PADDING + i * PLANT_SPACING + PLANT_SPACING / 2}px`;
            wrapper.style.top = `${skyHeight}px`;
            void this.renderPlantSprite(wrapper, project);
        });


        // --- The borders between your plants and your friends' ---
        this.app.gardenData.forEach((project, i) => {
            const section = this.app.sectionOf(project);
            if (section !== 'own') {
                const band = world.createDiv('garden-friend-band');
                band.style.left = `${WORLD_PADDING + i * PLANT_SPACING}px`;
                band.style.width = `${PLANT_SPACING}px`;
            }
            const prev = this.app.gardenData[i - 1];
            if (prev && this.app.sectionOf(prev) !== section) {
                const border = world.createDiv('garden-section-border');
                border.style.left = `${WORLD_PADDING + i * PLANT_SPACING}px`;
            }
        });

        // Apply the restored pan/zoom transform
        this.applyWorldTransform(world, viewport);
        this.settleCamera(false);
        // A pane that changes size (the divider, a rotated phone) keeps the garden filling it.
        this._viewportObserver = new ResizeObserver(() => {
            if (viewport.isConnected && !this.isDragging) this.settleCamera(false);
        });
        this._viewportObserver.observe(viewport);


        viewport.addEventListener('mousedown', this.handleMouseDown);
        viewport.addEventListener('wheel', this.handleWheel, { passive: false });
        viewport.addEventListener('mousemove', this.handlePeekMove);
        viewport.addEventListener('contextmenu', this.handleGardenContextMenu);
        viewport.addEventListener('mouseleave', this.handlePeekLeave);
        viewport.addEventListener('click', (e) => {
            const down = this._mouseDownAt;
            if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) this.peekTap(e.clientX, e.clientY, e.target);
        });
        this._peekEl = null;
        this._peekProjectId = null;
        
        // Mobile Touch Listeners
        viewport.addEventListener('touchstart', this.handleTouchStart, { passive: false });
        viewport.addEventListener('touchmove', this.handleTouchMove, { passive: false });
        viewport.addEventListener('touchend', this.handleTouchEnd);
        viewport.addEventListener('touchcancel', this.handleTouchEnd);
        
        // Clean up global listeners to prevent duplicates on re-render
        window.removeEventListener('mousemove', this.handleMouseMove);
        window.removeEventListener('mouseup', this.handleMouseUp);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);
    }

    // Pre-calculate above-ground height and underground depth for a project
    private calculateProjectExtents(project: ProjectData): { aboveHeight: number; undergroundDepth: number } {
        const defaultStep = (STEM_ORIGIN_HEIGHT - STEM_OVERLAP_ORIGIN) * PIXEL_SCALE;
        const aboveCount = project.stem.length + project.flowers.length;
        const undergroundCount = 1 + project.roots.length + project.minerals.length; // +1 for seed
        return {
            aboveHeight: aboveCount * defaultStep,
            undergroundDepth: undergroundCount * defaultStep
        };
    }

    /** The sky right now: a colour and how far the stars have come out (the garden's sky settings). */
    private getDayNightState(): { skyColor: string; starOpacity: number } {
        const now = new Date();
        return skyAt(this.app.settings, now.getHours() + now.getMinutes() / 60);
    }

    /** A sprite's size on screen. A missing or unreadable one falls back to a stem's. */
    private async getImageDimensions(url: string | null): Promise<{ width: number; height: number }> {
        const img = url ? await loadImage(url) : null;
        if (!img || img.naturalWidth === 0) {
            return { width: STEM_ORIGIN_WIDTH * PIXEL_SCALE, height: STEM_ORIGIN_HEIGHT * PIXEL_SCALE };
        }
        return { width: Math.round(img.naturalWidth * PIXEL_SCALE), height: Math.round(img.naturalHeight * PIXEL_SCALE) };
    }


    private scareFireflies(projectId: string) {
        const wrapper = this.containerEl.querySelector<HTMLElement>(`.garden-plant-wrapper[data-project-id="${projectId}"]`);
        if (!wrapper) return;

        const leftStr = wrapper.style.left;
        const center = leftStr ? parseFloat(leftStr) : 0;
        const width = parseInt(wrapper.dataset.width || '30');
        const left = center - (width / 2);
        const right = center + (width / 2);

        for (const f of this.fireflyState) {
            if (f.isLanded && f.landedX >= left && f.landedX <= right) {
                f.isLanded = false;
                f.cx = f.landedX;
                f.cy = f.landedY;
                // Give them a gentle burst of speed to fly away
                f.vx = (Math.random() - 0.5) * 0.5;
                f.vy = -0.25; // Gently float upwards
                f.landedUntil = 0;
            }
        }
    }

    
    /** Find the board copy of one cell without relying on CSS-escaped ids. */
    private kanbanCell(itemId: string, projectId: string): HTMLElement | null {
        const board = this.containerEl.querySelector<HTMLElement>('.kanban-scroll-container');
        if (!board) return null;
        const column = Array.from(board.querySelectorAll<HTMLElement>('.project-column'))
            .find((el) => el.dataset.projectId === projectId);
        if (!column) return null;
        return Array.from(column.querySelectorAll<HTMLElement>('.garden-item, .seed-content'))
            .find((el) => el.dataset.id === itemId) ?? null;
    }

    /** Bring a plant part's corresponding card cell into view and make it unmistakable. */
    private focusKanbanCell(itemId: string, projectId: string): boolean {
        const cell = this.kanbanCell(itemId, projectId);
        if (!cell) return false;

        cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        cell.addClass('is-focus-highlighted');
        cell.addClass('is-click-flash');

        // A later tap on the same cell owns the highlight timer.
        const token = String(performance.now());
        cell.dataset.focusToken = token;
        window.setTimeout(() => {
            if (cell.dataset.focusToken !== token) return;
            delete cell.dataset.focusToken;
            cell.removeClass('is-focus-highlighted');
            cell.removeClass('is-click-flash');
        }, 900);
        return true;
    }

    private attachPlantPartEvents(partDiv: HTMLElement, itemId: string, projectId: string) {
        // Only scare fireflies if interacting with above-ground parts!
        const isAboveGround = partDiv.classList.contains('garden-stem-part') || partDiv.classList.contains('garden-flower-part');

        partDiv.addEventListener('mouseenter', () => {
            if (isAboveGround) this.scareFireflies(projectId);
            const cell = this.kanbanCell(itemId, projectId);
            if (cell) cell.addClass('is-hover-highlighted');
        });

        partDiv.addEventListener('mouseleave', () => {
            const cell = this.kanbanCell(itemId, projectId);
            if (cell) cell.removeClass('is-hover-highlighted');
        });

        partDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isAboveGround) this.scareFireflies(projectId);
            this.focusKanbanCell(itemId, projectId);
        });
    }

    /**
     * One plant: flowers and stems stacked up from the horizon, the seed on it,
     * roots and minerals paired going down. Every part is one FIXED_STACK_STEP
     * from the one before it, so a taller sprite simply overlaps further.
     */
    private async renderPlantSprite(parent: HTMLElement, project: ProjectData) {
        const stemContainer = parent.createDiv("garden-stem-container");
        // Standby paints the whole plant one colour, so a hue on top of it would fight it.
        stemContainer.style.filter = project.standby ? 'none' : `hue-rotate(${project.hue ?? 0}deg)`;
        stemContainer.toggleClass('is-standby-plant', !!project.standby);
        const settings = this.app.settings;
        if (project.standby && settings.silhouetteOpacity !== 100) {
            stemContainer.style.opacity = String(Math.min(100, Math.max(0, settings.silhouetteOpacity)) / 100);
        }
        // A silhouette in a colour of the garden's choosing: the sprite as a mask over that colour.
        const tint = project.standby && /^#[0-9a-f]{6}$/i.test(settings.silhouetteColor) ? settings.silhouetteColor : null;

        let maxWidth = 0;

        /** Draw one cell's sprite at `top`, flipped on every other one of its kind. */
        const part = async (
            type: 'stem' | 'flower' | 'seed' | 'root' | 'mineral',
            item: { id: string; imagePath?: string; highlighted?: boolean },
            top: (height: number) => number,
            flipped: boolean,
        ) => {
            const el = stemContainer.createDiv(`garden-part garden-${type}-part`);
            el.dataset.itemId = item.id;
            this.attachPlantPartEvents(el, item.id, project.id);
            el.toggleClass('garden-part-slow-pulse', !!item.highlighted);

            let url = item.imagePath ? this.app.assetManager.getImageUrlSync(item.imagePath) : null;
            if (!url && (type === 'stem' || type === 'flower')) {
                // A plant from before the art pack: fall back to the bundled plant_1 sprites.
                const hash = simpleHash(item.id);
                url = type === 'flower' ? (hash % 2 === 0 ? flower1Url : flower2Url) : stemParts[hash % stemParts.length];
            }

            const { width, height } = await this.getImageDimensions(url);
            maxWidth = Math.max(maxWidth, width);
            if (tint && url && (type === 'stem' || type === 'flower')) {
                el.addClass('is-tinted');
                el.style.backgroundColor = tint;
                el.style.setProperty('mask-image', `url(${url})`);
            } else {
                el.style.backgroundImage = url ? `url(${url})` : 'none';
            }
            el.style.width = `${width}px`;
            el.style.height = `${height}px`;
            el.style.top = `${top(height)}px`;
            el.style.transform = flipped ? 'translateX(-50%) scaleX(-1)' : 'translateX(-50%)';
            return el;
        };

        // Above ground, nearest the horizon first: stems, then flowers on top.
        const above = [
            ...[...project.stem].reverse().map(s => ({ type: 'stem' as const, item: s })),
            ...[...project.flowers].reverse().map(f => ({ type: 'flower' as const, item: f })),
        ];
        for (const [i, block] of above.entries()) {
            await part(block.type, block.item, (height) => -(i * FIXED_STACK_STEP + height), i % 2 !== 0);
        }

        await part('seed', { id: project.id, imagePath: project.seedImagePath }, () => 0, false);

        // Below ground, a root and a mineral share each step. Standby keeps the roots only, unless the garden says otherwise.
        const depth = Math.max(project.roots.length, project.minerals.length);
        const showMinerals = !project.standby || !settings.standbyHidesMinerals;
        for (let i = 0; i < depth; i++) {
            const y = (i + 1) * FIXED_STACK_STEP;
            if (project.roots[i]) await part('root', project.roots[i], () => y, i % 2 !== 0);
            if (project.minerals[i] && showMinerals) {
                const el = await part('mineral', project.minerals[i], () => y, i % 2 !== 0);
                const opacity = mineralOpacity(settings, i, project.minerals.length);
                if (opacity < 1) el.style.opacity = String(opacity);
            }
        }

        // Centre the plant on its anchor, and leave the width where the fireflies can read it.
        stemContainer.style.width = `${maxWidth}px`;
        stemContainer.style.left = `${-maxWidth / 2}px`;
        parent.dataset.width = maxWidth.toString();
    }


    /** The sprite a cell grew: stem, flower, root, mineral or the seed itself. */
    private plantPart(itemId: string): HTMLElement | null {
        return this.containerEl.querySelector(`.garden-plants-layer [data-item-id="${itemId}"]`);
    }

    private highlightPlantPart(itemId: string) {
        const part = this.plantPart(itemId);
        if (!part) return;
        // The bounce keyframes scale the part, so they need the transform that
        // centres it (and flips every other one) to build on.
        part.style.setProperty('--original-transform', part.style.transform || 'scaleX(1)');
        // Restart the one-shot bounce even when it is already on.
        part.removeClass('garden-part-bounce');
        void part.offsetWidth;
        part.addClass('garden-part-bounce', 'garden-part-highlighted');
    }

    private unhighlightPlantPart(itemId: string) {
        this.plantPart(itemId)?.removeClass('garden-part-highlighted');
    }

    /** Write the garden and draw it again: what every edit from a menu or a key does. */
    private async save() {
        await this.app.saveGardenData();
        await this.onOpen();
    }

    /**
     * Store updates (another tab, another device) replace app.gardenData with fresh objects,
     * so a project captured by a modal or an event handler may be stale by the time it is used.
     * Always mutate the live object.
     */
    private live(project: ProjectData): ProjectData {
        return this.app.gardenData.find(p => p.id === project.id) ?? project;
    }

    private liveItem(itemId: string): LayerItem | null {
        for (const p of this.app.gardenData) {
            for (const layer of ['stem', 'flowers', 'roots', 'minerals'] as const) {
                const found = p[layer].find(i => i.id === itemId);
                if (found) return found;
            }
        }
        return null;
    }

    private _highlightedItemId: string | null = null;

    // --- Keyboard shortcuts ---
    // On the document, so they work wherever focus is, and ignored while
    // typing into a field or a cell, or while a dialog is open.

    private _shortcutsInstalled = false;
    /** Cells copied or cut here, so a paste keeps their art and state. */
    private _clipboardItems: LayerItem[] = [];

    private installShortcuts() {
        if (this._shortcutsInstalled) return;
        this._shortcutsInstalled = true;
        document.addEventListener('keydown', this.handleShortcut);
        if (systemClipboard) {
            document.addEventListener('copy', this.handleCopy);
            document.addEventListener('cut', this.handleCut);
            document.addEventListener('paste', this.handlePaste);
        }
    }

    private removeShortcuts() {
        this._shortcutsInstalled = false;
        document.removeEventListener('keydown', this.handleShortcut);
        if (systemClipboard) {
            document.removeEventListener('copy', this.handleCopy);
            document.removeEventListener('cut', this.handleCut);
            document.removeEventListener('paste', this.handlePaste);
        }
    }

    private shortcutsBlocked(target: EventTarget | null): boolean {
        if (document.documentElement.dataset.context === 'popup') return true;
        if (document.querySelector('.modal-container')) return true;
        const el = target as HTMLElement | null;
        if (!el || !el.closest) return false;
        return !!el.closest('input, textarea, select, [contenteditable="true"]');
    }

    /** Where a cell element lives in the garden. */
    private locateCell(el: HTMLElement) {
        const projectId = el.parentElement?.dataset.projectId;
        const arrayName = el.parentElement?.dataset.array as LayerName | undefined;
        const project = this.app.gardenData.find(p => p.id === projectId);
        if (!project || !arrayName || !el.dataset.id) return null;
        const index = project[arrayName].findIndex(i => i.id === el.dataset.id);
        if (index === -1) return null;
        return { project, arrayName, index, item: project[arrayName][index] };
    }

    private selectedLocations() {
        return this.selectedCells
            .filter(el => el.isConnected)
            .map(el => this.locateCell(el))
            .filter((l): l is NonNullable<typeof l> => l !== null);
    }

    /** After a re-render, select the cells with these ids again. */
    private async reselect(ids: string[]) {
        await this.onOpen();
        this.clearSelection();
        for (const id of ids) {
            const el = this.shownEl(`.garden-item[data-id="${id}"]`);
            if (el) this.select(el);
        }
        this.selectedCells[this.selectedCells.length - 1]?.focus();
    }

    private copyOf(item: LayerItem, n: number): LayerItem {
        return { ...item, id: `item_${Date.now()}_${n}` };
    }

    /** Insert copies of items right after the last selected cell, or at the top of its zone. */
    private async insertItems(items: LayerItem[]) {
        const anchor = this.selectedLocations().pop();
        if (!anchor || items.length === 0) return;
        const copies = items.map((item, n) => this.copyOf(item, n));
        anchor.project[anchor.arrayName].splice(anchor.index + 1, 0, ...copies);
        await this.app.saveGardenData();
        await this.reselect(copies.map(c => c.id));
    }

    private handleCopy = (e: ClipboardEvent) => {
        if (!systemClipboard || this.shortcutsBlocked(e.target)) return;
        const locs = this.selectedLocations();
        if (locs.length === 0) return;
        e.preventDefault();
        this._clipboardItems = locs.map(l => ({ ...l.item }));
        e.clipboardData?.setData('text/plain', this._clipboardItems.map(i => i.content).join('\n'));
    };

    private handleCut = (e: ClipboardEvent) => {
        if (!systemClipboard || this.shortcutsBlocked(e.target)) return;
        if (this.selectedLocations().length === 0) return;
        this.handleCopy(e);
        void this.deleteSelectedCells();
    };

    private handlePaste = (e: ClipboardEvent) => {
        if (!systemClipboard || this.shortcutsBlocked(e.target)) return;
        if (this.selectedLocations().length === 0) return;
        const text = e.clipboardData?.getData('text/plain') ?? '';
        const ours = this._clipboardItems.map(i => i.content).join('\n');
        let items: LayerItem[];
        if (this._clipboardItems.length > 0 && text === ours) {
            items = this._clipboardItems;
        } else {
            const anchor = this.selectedLocations().pop()!;
            items = text.split(/\r?\n/).map(t => t.trim()).filter(Boolean).map((content, n) => ({
                id: `item_${Date.now()}_${n}`,
                content,
                isComplete: anchor.arrayName === 'flowers',
                imagePath: this.app.assetManager.assignRandomImage(anchor.arrayName, anchor.project.plantType) || undefined,
            }));
        }
        if (items.length === 0) return;
        e.preventDefault();
        void this.insertItems(items);
    };

    /** Move the selection to the next cell up or down its zone, or across to the next plant. */
    private moveSelection(key: string) {
        const current = this.selectedCells[this.selectedCells.length - 1];
        const all = Array.from(this.contentEl.querySelectorAll<HTMLElement>('.garden-item[data-id]'));
        if (all.length === 0) return;
        if (!current || !current.isConnected) {
            this.selectSingleCell(all[0]);
            all[0].focus();
            return;
        }
        let next: HTMLElement | undefined;
        if (key === 'ArrowUp' || key === 'ArrowDown') {
            const column = current.closest('.project-column');
            const inColumn = all.filter(el => el.closest('.project-column') === column);
            const i = inColumn.indexOf(current);
            next = inColumn[key === 'ArrowUp' ? i - 1 : i + 1];
        } else {
            const columns = Array.from(this.contentEl.querySelectorAll('.project-column'));
            const col = columns.indexOf(current.closest('.project-column')!);
            const zone = current.parentElement?.dataset.array;
            for (let c = col + (key === 'ArrowLeft' ? -1 : 1); c >= 0 && c < columns.length; c += key === 'ArrowLeft' ? -1 : 1) {
                const cells = Array.from(columns[c].querySelectorAll<HTMLElement>('.garden-item[data-id]'));
                next = cells.find(el => el.parentElement?.dataset.array === zone) ?? cells[0];
                if (next) break;
            }
        }
        if (!next) return;
        this.selectSingleCell(next);
        next.focus();
        next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    /** The plant a shortcut acts on: the selected cell's, or the first one. */
    private shortcutProject(): ProjectData | undefined {
        return this.selectedLocations().pop()?.project ?? this.app.gardenData[0];
    }

    private handleShortcut = (e: KeyboardEvent) => {
        if (this.shortcutsBlocked(e.target)) return;
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key;

        if (e.shiftKey && !mod && key.toLowerCase() === 'd') {
            const locs = this.selectedLocations();
            if (locs.length === 0) return;
            e.preventDefault();
            void this.insertItems(locs.map(l => l.item));
            return;
        }
        if (mod && key.toLowerCase() === 'a') {
            const current = this.selectedCells[this.selectedCells.length - 1];
            const list = current?.parentElement;
            if (!list) return;
            e.preventDefault();
            this.clearSelection();
            (Array.from(list.querySelectorAll<HTMLElement>('.garden-item[data-id]'))).forEach(el => this.select(el));
            return;
        }
        // The Obsidian build deliberately never touches the system clipboard.
        // Cmd/Ctrl+C/X/V still work there through this internal cell buffer.
        if (mod && !systemClipboard) {
            const lower = key.toLowerCase();
            if (lower === 'c' || lower === 'x') {
                const locs = this.selectedLocations();
                if (locs.length === 0) return;
                e.preventDefault();
                this._clipboardItems = locs.map(l => ({ ...l.item }));
                if (lower === 'x') void this.deleteSelectedCells();
                return;
            }
            if (lower === 'v' && this._clipboardItems.length > 0 && this.selectedLocations().length > 0) {
                e.preventDefault();
                void this.insertItems(this._clipboardItems);
                return;
            }
        }
        if (mod || e.altKey) return;

        if (key.startsWith('Arrow')) {
            e.preventDefault();
            this.moveSelection(key);
            return;
        }
        if (key === 'Escape') {
            if (this.selectedCells.length === 0) this.hidePeek();
            this.clearSelection();
            (document.activeElement as HTMLElement | null)?.blur?.();
            return;
        }
        if (e.shiftKey && key !== '?') return;

        const zones: Record<string, LayerName> = { f: 'flowers', s: 'stem', r: 'roots', m: 'minerals' };
        const lower = key.toLowerCase();
        if (zones[lower]) {
            const project = this.shortcutProject();
            if (!project) return;
            e.preventDefault();
            void this.addNewItem(project, zones[lower]);
        } else if (lower === 'n') {
            e.preventDefault();
            void this.createNewProject('right');
        } else if (lower === 'b') {
            e.preventDefault();
            (document.querySelector<HTMLElement>('.garden-board-toggle'))?.click();
        } else if (key === '?') {
            e.preventDefault();
            new ShortcutsModal().open();
        }
    };

    private selectedCells: HTMLElement[] = [];

    private clearSelection() {
        this.selectedCells.forEach(c => {
            c.removeClass("is-selected");
            const itemId = c.dataset.id;
            if (itemId) this.unhighlightPlantPart(itemId); // Unhighlight plant part!
        });
        this.selectedCells = [];
        if (this._highlightedItemId) {
            this.unhighlightPlantPart(this._highlightedItemId);
            this._highlightedItemId = null;
        }
    }

    /** Add a cell to the selection and light up the sprite it grew. */
    private select(el: HTMLElement) {
        if (el.hasClass('is-selected')) return;
        el.addClass('is-selected');
        this.selectedCells.push(el);
        if (el.dataset.id) this.highlightPlantPart(el.dataset.id);
    }

    private unselect(el: HTMLElement) {
        el.removeClass('is-selected');
        this.selectedCells = this.selectedCells.filter(c => c !== el);
        if (el.dataset.id) this.unhighlightPlantPart(el.dataset.id);
    }

    private selectSingleCell(el: HTMLElement) {
        this.clearSelection();
        el.addClass("is-selected");
        this.selectedCells.push(el);
        const itemId = el.dataset.id;
        if (itemId) {
            this._highlightedItemId = itemId;
            this.highlightPlantPart(itemId);
        }
    }

    private async deleteSelectedCells() {
        const locations = this.selectedLocations();
        if (locations.length === 0) return;
        for (const { project, arrayName, item } of locations) {
            project[arrayName] = project[arrayName].filter(i => i.id !== item.id);
        }
        this.clearSelection();
        await this.save();
    }

    /** Select the seed's cell: the board's own cells go through selectSingleCell. */
    private selectCell(el: HTMLElement) {
        if (this._highlightedItemId) this.unhighlightPlantPart(this._highlightedItemId);
        this.containerEl.querySelectorAll('.garden-item.is-selected').forEach(s => s.removeClass('is-selected'));
        el.addClass('is-selected');
        this._highlightedItemId = el.dataset.id ?? null;
        if (this._highlightedItemId) this.highlightPlantPart(this._highlightedItemId);
    }

    private deselectCell(el: HTMLElement) {
        el.removeClass('is-selected');
        const itemId = el.dataset.id;
        if (itemId && this._highlightedItemId === itemId) {
            this.unhighlightPlantPart(itemId);
            this._highlightedItemId = null;
        }
    }

    private startEditing(el: HTMLElement) {
        el.removeClass('is-selected');
        el.addClass('is-editing');
        el.contentEditable = "true";
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    }

    private stopEditing(el: HTMLElement, item: LayerItem) {
        el.removeClass('is-editing');
        el.contentEditable = "false";
        const newText = el.getText().trim();
        if (newText !== item.content) {
            item.content = newText;
            const live = this.liveItem(item.id);
            if (live && live !== item) live.content = newText;
            void this.app.saveGardenData();
        }
    }

    private async deleteCell(item: LayerItem, project: ProjectData, arrayName: LayerName) {
        const target = this.live(project);
        const index = target[arrayName].findIndex(i => i.id === item.id);
        if (index !== -1) {
            target[arrayName].splice(index, 1);
            await this.save();
        }
    }


// --- Divider ratio saves after edit ---
private _splitRatio = 0.5; // persisted divider position (0 = top, 1 = bottom)


    private showSeedContextMenu(e: MouseEvent, project: ProjectData) {
        const rename = (type: string) => type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
        const others = PLANT_TYPES.filter(pt => pt !== project.plantType);
        const items: MenuItem[] = [
            {
                label: project.standby ? 'Wake up' : 'Standby',
                onClick: () => {
                    const live = this.live(project);
                    live.standby = project.standby = !live.standby;
                    void this.save();
                },
            },
            { label: 'Recycle plant', danger: true, onClick: () => this.confirmRecycle(project) },
        ];
        if (others.length > 0) items.push({ label: 'Change plant type', heading: true });
        for (const pt of others) {
            items.push({
                label: rename(pt),
                onClick: () => {
                    // A new type means new art for everything the pack keeps per plant.
                    const live = this.live(project);
                    live.plantType = pt;
                    for (const layer of ['stem', 'flowers'] as const) {
                        for (const item of live[layer]) item.imagePath = this.app.assetManager.assignRandomImage(layer, pt) || undefined;
                    }
                    void this.save();
                },
            });
        }
        openMenu(items, { x: e.clientX, y: e.clientY }, this.containerEl.ownerDocument);
    }

    /** The menu on a cell, acting on the whole selection when there is one. */
    private showCellContextMenu(
        e: MouseEvent,
        cells: HTMLElement[],
        one: { item: LayerItem; project: ProjectData; arrayName: LayerName },
    ) {
        const multi = cells.length > 1;
        const locations = () => cells.map(c => this.locateCell(c)).filter((l): l is NonNullable<typeof l> => l !== null);
        const highlighted = cells.every(c => c.hasClass('garden-item-highlighted'));
        const allMinerals = cells.every(c => c.parentElement?.dataset.array === 'minerals');

        openMenu([
            {
                label: 'Delete',
                onClick: () => {
                    if (multi) void this.deleteSelectedCells();
                    else void this.deleteCell(one.item, one.project, one.arrayName);
                },
            },
            {
                label: highlighted ? 'Remove highlight' : 'Highlight',
                onClick: async () => {
                    for (const { item } of locations()) item.highlighted = !highlighted || undefined;
                    await this.save();
                },
            },
            {
                label: 'Convert to stem',
                disabled: !allMinerals,
                onClick: async () => {
                    // By id, not by index: each move renumbers the list behind it.
                    for (const { project, item } of locations()) {
                        const at = project.minerals.findIndex(m => m.id === item.id);
                        if (at === -1) continue;
                        project.minerals.splice(at, 1);
                        item.imagePath = this.app.assetManager.assignRandomImage('stem', project.plantType) || undefined;
                        project.stem.push(item);
                    }
                    this.clearSelection();
                    await this.save();
                },
            },
        ], { x: e.clientX, y: e.clientY });
    }

    private confirmRecycle(project: ProjectData) {
        new ConfirmDeleteModal(project.seed, async () => {
            const index = this.app.gardenData.findIndex(p => p.id === project.id);
            if (index === -1) return;
            this.app.gardenData.splice(index, 1);
            await this.save();
        }).open();
    }

    createProjectColumn(parent: HTMLElement, project: ProjectData) {

        const column = parent.createDiv({ cls: "project-column" });
        column.dataset.projectId = project.id;
        // Where your garden ends and your friends' plants begin.
        const section = this.app.sectionOf(project);
        if (section !== 'own') column.addClass('is-friend-plant');
        const index = this.app.gardenData.indexOf(project);
        const next = this.app.gardenData[index + 1];
        if (next && this.app.sectionOf(next) !== section) column.addClass('is-section-end');

        const columnCard = column.createDiv("column-card");
        const columnBody = columnCard.createDiv("column-body");

        // --- TOP HALF (Flowers, Stem) ---
        const topHalf = columnBody.createDiv("column-top-half");
        this.createZone(topHalf, project, 'flowers');
        this.createZone(topHalf, project, 'stem');

        // --- SEED (Now acts as the header) ---
        const seedCell = columnBody.createDiv("garden-zone seed-cell");
        
        seedCell.createDiv({ cls: "column-drag-handle", text: "⠿" });
        const seedContent = seedCell.createDiv({ text: project.seed, cls: "seed-content draggable-cell", attr: { tabindex: "0" } });
        seedContent.dataset.id = project.id;
        seedContent.contentEditable = "false";
        
        // Apply Hue Filter
        seedContent.setCssStyles({ color: '#6e7f9c' });
        seedContent.style.filter = `hue-rotate(${project.hue ?? 0}deg)`;

        seedContent.addEventListener("click", (e) => {
            if (seedContent.hasClass("is-editing")) return;
            e.stopPropagation();
            this.selectCell(seedContent);
        });

        seedContent.addEventListener("dblclick", () => this.startEditing(seedContent));

        seedContent.addEventListener("blur", () => {
            if (!seedContent.hasClass("is-editing")) {
                this.deselectCell(seedContent);
                return;
            }
            seedContent.removeClass("is-editing");
            seedContent.contentEditable = "false";
            const seed = seedContent.getText().trim();
            // An emptied name is not a name: put the old one back.
            if (!seed) {
                seedContent.setText(project.seed);
                return;
            }
            if (seed === project.seed) return;
            const live = this.live(project);
            live.seed = live.name = project.seed = project.name = seed;
            void this.app.saveGardenData();
        });

        seedContent.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key !== "Enter") return;
            if (seedContent.hasClass("is-editing")) {
                e.preventDefault();
                seedContent.blur();
            } else if (seedContent.hasClass("is-selected")) {
                e.preventDefault();
                this.startEditing(seedContent);
            }
        });

        // --- Share: only where sharing is possible ---
        if (this.app.onSharePlant) {
            const shareBtn = seedCell.createEl('button', {
                cls: 'seed-context-btn seed-share-btn',
                attr: { type: 'button', title: 'Share this plant', 'aria-label': 'Share this plant' },
            });
            setIcon(shareBtn, ICONS.share);
            shareBtn.toggleClass('is-shared', !!project.sharedPlantId);
            shareBtn.onclick = (e) => {
                e.stopPropagation();
                this.app.onSharePlant?.(project.id);
            };
        }

        // --- Standby, and the menu ---
        const menuBtn = seedCell.createEl('button', { cls: 'seed-context-btn', attr: { type: 'button' } });
        const updateMenuBtn = () => {
            setIcon(menuBtn, project.standby ? ICONS.eyeClosed : ICONS.dots);
            menuBtn.toggleClass('is-standby-eye', !!project.standby);
            column.toggleClass('is-standby', !!project.standby);
        };

        // Clicking the eye toggles standby off. Clicking the dots opens the menu.
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            if (project.standby) {
                project.standby = false;
                this.live(project).standby = false;
                void this.save();
            } else {
                this.showSeedContextMenu(e, project);
            }
        };

        // Hover effect: swap to open eye
        // On a sleeping plant the shut eye opens under the pointer: click to wake it.
        menuBtn.addEventListener('mouseenter', () => {
            if (project.standby) setIcon(menuBtn, ICONS.eyeOpen);
        });
        menuBtn.addEventListener('mouseleave', () => {
            if (project.standby) setIcon(menuBtn, ICONS.eyeClosed);
        });

        // Right-click on seed text also opens the menu
        seedContent.addEventListener("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.showSeedContextMenu(e, project);
        });

        updateMenuBtn(); // Set initial state

        // --- BOTTOM HALF (Roots, Minerals) ---
        const bottomHalf = columnBody.createDiv("column-bottom-half");
        this.createZone(bottomHalf, project, 'roots');
        this.createZone(bottomHalf, project, 'minerals');
    }

    /** One zone of a card: its label, its + and its list. The four differ only in name. */
    private createZone(parent: HTMLElement, project: ProjectData, arrayName: LayerName) {
        const zone = parent.createDiv(`garden-zone ${arrayName}-zone`);
        const label = zone.createDiv("garden-zone-label-row");
        const name = label.createDiv({ cls: "zone-label" });
        setIcon(name.createSpan({ cls: "zone-icon" }), ZONE_ICONS[arrayName]);
        name.createSpan({ text: ZONE_LABELS[arrayName] });
        const add = label.createEl('button', { cls: 'zone-add-btn', text: '+' });
        add.onclick = () => this.addNewItem(project, arrayName);
        this.createSortableList(zone, project, arrayName);
    }

    createSortableList(parent: HTMLElement, project: ProjectData, arrayName: LayerName) {
        const listContainer = parent.createDiv({ cls: "kanban-list" });
        listContainer.dataset.projectId = project.id;
        listContainer.dataset.array = arrayName;

        project[arrayName].forEach(item => {
            const el = listContainer.createDiv({ cls: "garden-item draggable-cell", attr: { tabindex: "0" } });
            el.dataset.id = item.id;
            el.setText(item.content);
            if (item.highlighted) {
                el.setCssStyles({ fontWeight: 'bold' });
                el.addClass('garden-item-highlighted');
            }
            
            el.addEventListener("mouseenter", () => {
                if (arrayName === 'stem' || arrayName === 'flowers') this.scareFireflies(project.id);
                this.highlightPlantPart(item.id);
            });

            el.addEventListener("mouseleave", () => {
                // Only remove brightness if the cell isn't selected
                if (!el.hasClass("is-selected")) {
                    this.unhighlightPlantPart(item.id);
                }
            });

            el.addEventListener("click", (e) => {
                // The second click of a double-click belongs to editing, not selecting.
                if (e.detail === 2 || el.hasClass("is-editing")) return;
                e.stopPropagation();
                if (arrayName === 'stem' || arrayName === 'flowers') this.scareFireflies(project.id);

                const list = el.parentElement;
                const last = this.selectedCells[this.selectedCells.length - 1];

                if (e.ctrlKey || e.metaKey) {
                    // A selection never spans two plants.
                    const open = this.selectedCells[0]?.parentElement?.dataset.projectId;
                    if (open !== undefined && open !== list?.dataset.projectId) this.clearSelection();
                    if (el.hasClass("is-selected")) this.unselect(el);
                    else this.select(el);
                    return;
                }

                if (e.shiftKey && list && last?.parentElement === list) {
                    // Everything from the cell selected last to this one, in this zone.
                    const cells = (Array.from(list.children) as HTMLElement[]).filter(c => c.hasClass('garden-item'));
                    const [from, to] = [cells.indexOf(last), cells.indexOf(el)].sort((a, b) => a - b);
                    for (const cell of cells.slice(from, to + 1)) this.select(cell);
                    return;
                }

                this.selectSingleCell(el);
            });

            el.addEventListener("dblclick", () => this.startEditing(el));

            el.addEventListener("blur", () => {
                if (el.hasClass("is-editing")) this.stopEditing(el, item);
                else this.deselectCell(el);
            });

            el.addEventListener("keydown", (e: KeyboardEvent) => {
                const erase = e.key === "Backspace" || e.key === "Delete";
                if (e.key !== "Enter" && !erase) return;
                const editing = el.hasClass("is-editing");
                if (!editing && !el.hasClass("is-selected")) return;

                if (e.key === "Enter") {
                    e.preventDefault();
                    if (!editing) return this.startEditing(el);
                    this.stopEditing(el, item);
                    el.blur();
                    return;
                }
                // Backspace in an emptied cell deletes it, as it does on the board.
                if (editing && el.getText().trim() !== "") return;
                e.preventDefault();
                if (!editing && this.selectedCells.length > 1) void this.deleteSelectedCells();
                else void this.deleteCell(item, project, arrayName);
            });

            el.addEventListener("contextmenu", (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                const multi = this.selectedCells.includes(el) && this.selectedCells.length > 1;
                if (!multi) this.selectSingleCell(el);
                this.showCellContextMenu(e, multi ? this.selectedCells : [el], { item, project, arrayName });
            });
        });

        Sortable.create(listContainer, {
            group: 'garden-items',
            animation: 150,
            // Touch: hold to pick up, so a swipe still scrolls the board.
            delay: 250,
            delayOnTouchOnly: true,
            touchStartThreshold: 6,
            ghostClass: 'sortable-ghost',
            onEnd: (evt: SortableEvent) => void this.handleDrop(evt)
        });
    }

    async handleDrop(evt: SortableEvent) {
        const targetProjectId = evt.to.dataset.projectId;
        const sourceProjectId = evt.from.dataset.projectId;
        const targetArrayName = evt.to.dataset.array as LayerName;
        const sourceArrayName = evt.from.dataset.array as LayerName;
        const itemId = evt.item.dataset.id;

        if (!targetProjectId || !sourceProjectId || !targetArrayName || !sourceArrayName || !itemId) return;

        const sourceProject = this.app.gardenData.find(p => p.id === sourceProjectId);
        const targetProject = this.app.gardenData.find(p => p.id === targetProjectId);
        if (!sourceProject || !targetProject) return;

        const sourceArray = sourceProject[sourceArrayName];
        const itemIndex = sourceArray.findIndex(i => i.id === itemId);
        if (itemIndex === -1) return;

        const movedItem = sourceArray.splice(itemIndex, 1)[0];
        if (!movedItem) return;

        // If moved to a different category, reassign image to match new category
        if (sourceArrayName !== targetArrayName) {
            movedItem.imagePath = this.app.assetManager.assignRandomImage(targetArrayName, targetProject.plantType) || undefined;
        }

        const targetArray = targetProject[targetArrayName];
        const newIndex = evt.newIndex ?? 0;
        targetArray.splice(newIndex, 0, movedItem);

        await this.app.saveGardenData();

        // --- TARGETED UPDATE ---
        // If reordering within the exact same list, the Kanban DOM is already correct (Sortable moved it).
        // We just need to redraw the plant sprite on the canvas to match the new order.
        // This prevents the scrollbar from jumping!
        if (sourceProjectId === targetProjectId && sourceArrayName === targetArrayName) {
            const wrapper = this.containerEl.querySelector<HTMLElement>(`.garden-plant-wrapper[data-project-id="${targetProjectId}"]`);
            if (wrapper) {
                wrapper.empty();
                await this.renderPlantSprite(wrapper, targetProject);
                return; // Skip the full re-render!
            }
        }

        // If moving between different columns or categories, extents might change. Do a full render.
        this.scheduleRender();
    }

    async handleColumnDrop(evt: SortableEvent) {
        if (evt.oldIndex === undefined || evt.newIndex === undefined || evt.oldIndex === evt.newIndex) return;

        // Sortable indices include the +Left button at index 0, so subtract 1
        const oldIdx = evt.oldIndex - 1;
        let newIdx = evt.newIndex - 1;

        // Clamp: can't go before 0 or past the last project
        const maxIdx = this.app.gardenData.length - 1;
        if (oldIdx < 0 || newIdx < 0 || oldIdx > maxIdx || newIdx > maxIdx) return;

        const [movedProject] = this.app.gardenData.splice(oldIdx, 1);
        if (!movedProject) return;

        // Adjust newIdx if we removed an item before it
        if (oldIdx < newIdx) newIdx--;
        this.app.gardenData.splice(newIdx, 0, movedProject);

        // UPDATE ALL ORDERS: Assign 0, 1, 2, 3... based on current array position
        this.app.gardenData.forEach((proj, idx) => {
            proj.order = idx;
        });

        await this.save();
    }

     async createNewProject(position: 'left' | 'right' = 'right') {
        new CreateProjectModal(async (seed) => {
            const seedImagePath = this.app.assetManager.assignRandomImage('seeds'); 

             const newProject: ProjectData = {
                id: 'proj_' + Date.now(),
                name: seed,
                seed: seed,
                seedImagePath: seedImagePath || undefined,
                standby: false,
                hue: Math.floor(Math.random() * 360),
                order: this.app.gardenData.length,
                plantType: PLANT_TYPES[Math.floor(Math.random() * PLANT_TYPES.length)],
                roots: [],
                stem: [],
                flowers: [],
                minerals: []
            };

            if (position === 'left') {
                this.app.gardenData.unshift(newProject);
            } else {
                this.app.gardenData.push(newProject);
            }
            // Renumber so a plant added on the left stays on the left after reload (data is sorted by order)
            this.app.gardenData.forEach((proj, idx) => { proj.order = idx; });

            await this.save();
        }).open();
    }

    /**
     * The + on a zone opens an empty cell right there at the top of the zone,
     * ready to type into. Enter or clicking away keeps it; Escape, or leaving it
     * empty, drops it. Only planting a seed still goes through a dialog.
     */
    async addNewItem(project: ProjectData, arrayName: 'flowers' | 'minerals' | 'roots' | 'stem') {
        const placeholders: Record<string, string> = {
            'flowers': 'Result, takeaway',
            'stem': 'Completed task',
            'roots': 'Motivation, reason',
            'minerals': 'Idea, task'
        };

        const list = this.shownEl(`.project-column[data-project-id="${project.id}"] .${arrayName}-zone .kanban-list`);
        if (!list) return;
        list.querySelector('.garden-item.is-draft')?.remove();

        const draft = createDiv('garden-item draggable-cell is-editing is-draft');
        draft.dataset.placeholder = placeholders[arrayName] ?? '';
        draft.contentEditable = 'true';
        list.prepend(draft);
        draft.focus();
        draft.scrollIntoView({ block: 'nearest', inline: 'nearest' });

        let done = false;
        const finish = async (keep: boolean) => {
            if (done) return;
            done = true;
            const content = (draft.textContent ?? '').trim();
            if (!keep || !content) {
                draft.remove();
                return;
            }
            // Ask the manager for a random image from the matching vault folder
            const randomImagePath = this.app.assetManager.assignRandomImage(arrayName, project.plantType);
            const newItem: LayerItem = {
                id: 'item_' + Date.now(),
                content,
                isComplete: arrayName === 'flowers',
                imagePath: randomImagePath || undefined
            };
            this.live(project)[arrayName].unshift(newItem);
            await this.save();
        };

        draft.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void finish(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                void finish(false);
            }
        });
        draft.addEventListener('blur', () => { void finish(true); });
        // A tap inside the draft must not start a drag or select a cell.
        for (const type of ['mousedown', 'pointerdown', 'touchstart', 'click', 'dblclick']) {
            draft.addEventListener(type, (e) => e.stopPropagation());
        }
    }
}
