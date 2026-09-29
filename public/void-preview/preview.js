// Local-only preview. Decode the PNG into a small canvas before using its alpha.
const input = document.querySelector('#tile');
const status = document.querySelector('#status');
const pattern = document.querySelector('#pattern');
const preview = document.querySelector('#preview');
let generation = 0;
input.addEventListener('change', async () => {
    const current = ++generation;
    const file = input.files[0];
    if (!file) return;
    let url;
    try {
        if (file.size > 1024 * 1024) throw new Error('Choose a PNG smaller than 1 MB.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const signature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (!signature.every((byte, i) => bytes[i] === byte)) throw new Error('Choose a valid PNG image.');
        url = URL.createObjectURL(file);
        const image = new Image();
        image.src = url;
        await image.decode();
        if (image.naturalWidth !== 32 || image.naturalHeight !== 32) throw new Error('The tile must be exactly 32 × 32 pixels.');
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('This browser cannot preview the image.');
        ctx.drawImage(image, 0, 0);
        const rgba = ctx.getImageData(0, 0, 32, 32).data;
        let transparent = false, visible = false;
        for (let i = 3; i < rgba.length; i += 4) {
            transparent ||= rgba[i] < 255;
            visible ||= rgba[i] > 0;
        }
        if (!transparent || !visible) throw new Error('Use a PNG with both visible and transparent pixels.');
        if (current !== generation) return;
        const mask = `url("${canvas.toDataURL('image/png')}")`;
        pattern.style.maskImage = mask;
        pattern.style.webkitMaskImage = mask;
        pattern.classList.add('ready');
        status.textContent = `${file.name}: 32 × 32 alpha tile. Preview only; nothing has been published.`;
    } catch (error) {
        if (current === generation) status.textContent = error instanceof Error ? error.message : 'The image could not be previewed.';
    } finally {
        if (url) URL.revokeObjectURL(url);
    }
});
document.querySelector('#ink').addEventListener('input', event => { pattern.style.backgroundColor = event.target.value; });
document.querySelector('#ground').addEventListener('input', event => { preview.style.backgroundColor = event.target.value; });
document.querySelector('#reset').addEventListener('click', () => {
    generation++;
    input.value = '';
    pattern.classList.remove('ready');
    pattern.style.maskImage = pattern.style.webkitMaskImage = '';
    status.textContent = 'Choose a PNG to preview it at its native pixel size.';
});
