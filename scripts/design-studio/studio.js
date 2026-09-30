const element = id => document.getElementById(id);
let state = null;
let localError = '';
let posting = false;
let pollTimer;
let view = 'desktop';
let assetSignature = '';
let imageSignature = '';
let sceneSignature = '';

function safeExternal(value, host) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && [host, `www.${host}`].includes(url.hostname) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

function setLink(node, href) {
    node.hidden = !href;
    if (href) node.href = href;
    else node.removeAttribute('href');
}

function selected() { return state?.assets?.find(asset => asset.key === state.selectedAsset); }
function busy() { return posting || state?.busy === true; }
function text(id, value) { element(id).textContent = value ?? ''; }

function assetOptions() {
    const select = element('asset-select');
    const query = element('asset-search').value.trim().toLowerCase();
    const assets = (state?.assets ?? []).filter(asset => `${asset.label} ${asset.path}`.toLowerCase().includes(query));
    select.replaceChildren();
    for (const asset of assets) {
        const option = document.createElement('option');
        option.value = asset.key;
        option.textContent = `${asset.label} · ${asset.width} × ${asset.height}`;
        select.append(option);
    }
    if (!assets.length) {
        const option = document.createElement('option');
        option.textContent = 'No artwork matches your search'; option.disabled = true;
        select.append(option);
    } else if (assets.some(asset => asset.key === state.selectedAsset)) select.value = state.selectedAsset;
    else select.selectedIndex = -1;
}

function friendlyError(message) {
    if (/rate limit|try again tomorrow|quota|reauthentication|unauthorized|Figma pull unavailable/i.test(message)) return 'Figma is unavailable right now. Export a native 1× PNG from the linked component, then choose or drop that file here.';
    if (/stale|revision|changed in another|draft changed/i.test(message)) return 'The artwork changed while this page was open. Review the latest preview, then try again.';
    if (message.length > 220 || /\n\s*at\s|[a-f0-9]{64}/i.test(message)) return 'That action could not be completed. See technical details below, or try again.';
    return message;
}

function showScene() {
    const review = state?.review;
    if (!review?.files) return;
    const difference = element('show-difference').checked;
    element('desktop-view').setAttribute('aria-pressed', String(view === 'desktop'));
    element('mobile-view').setAttribute('aria-pressed', String(view === 'mobile'));
    element('scene-pair').hidden = difference;
    element('difference-scene').hidden = !difference;
    element('scene-pair').classList.toggle('mobile', view === 'mobile');
    element('difference-scene').classList.toggle('mobile', view === 'mobile');
    const comparison = review.comparisons?.find(item => item.viewport === view);
    text('comparison-summary', comparison ? comparison.changedPixels === 0 ? 'No visible pixel changes in this preview.' : `${comparison.changedPixels.toLocaleString()} pixels changed in this preview.` : 'Compare both sizes before approving.');
    const signature = `${review.rendererSha256}:${review.candidateSha256}:${review.createdAt}:${view}`;
    if (sceneSignature === signature) return;
    sceneSignature = signature;
    for (const [kind, imageId, linkId] of [['before', 'before-scene', 'before-scene-link'], ['after', 'after-scene', 'after-scene-link'], ['diff', 'difference-image', 'difference-link']]) {
        const index = review.files.findIndex(file => file.kind === kind && (file.path.split('/').at(-1) === `${view}-${kind}.png` || file.label?.startsWith(`${view}:`)));
        const image = element(imageId), link = element(linkId);
        if (index < 0) { image.removeAttribute('src'); link.removeAttribute('href'); continue; }
        const source = `/review-files/${index}`;
        image.src = source; link.href = source;
    }
}

function render() {
    if (!state) return;
    const asset = selected();
    const pending = busy();
    const report = state.report;
    const review = state.review;
    const hardBlocked = report?.hardBlocked === true;
    const identical = report?.identical === true;
    const reviewed = !!review && ['reviewed', 'approved', 'submitted'].includes(state.phase);
    const approved = ['approved', 'submitted'].includes(state.phase);
    const submitted = state.phase === 'submitted';
    const currentStep = approved ? 2 : report ? 1 : 0;
    ['step-artwork', 'step-preview', 'step-send'].forEach((id, index) => {
        const step = element(id);
        if (index === currentStep) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
        step.classList.toggle('complete', index < currentStep);
    });
    const newAssetSignature = JSON.stringify((state.assets ?? []).map(item => [item.key, item.label, item.width, item.height]));
    if (assetSignature !== newAssetSignature) { assetSignature = newAssetSignature; assetOptions(); }
    if (!element('asset-search').value) element('asset-select').value = state.selectedAsset ?? '';
    element('asset-select').disabled = pending || !asset;
    element('asset-search').disabled = pending;
    element('pull-button').disabled = pending || !asset;
    element('import-button').disabled = pending || !asset;
    element('png-file').disabled = pending || !asset;
    setLink(element('figma-link'), safeExternal(asset?.figmaUrl, 'figma.com'));
    text('asset-size', asset ? `${asset.width} × ${asset.height} px · native 1× PNG` : 'Choose artwork to begin.');

    element('status').classList.toggle('is-busy', pending);
    element('status').setAttribute('aria-busy', String(pending));
    const messages = { idle: 'Choose the artwork you want to review.', staged: 'Artwork is staged. Your website has not changed.', reviewed: 'Preview ready. Check the desktop and phone views.', approved: 'Artwork approved. Ready to open a dev review request.', submitted: 'Your review request is ready for the team.' };
    text('status-text', pending ? state.jobLabel || 'Working on your artwork…' : state.message || messages[state.phase] || messages.idle);
    const error = localError || (typeof state.error === 'string' ? state.error : state.error?.message) || '';
    element('error').hidden = !error; text('error', friendlyError(error));

    element('staged-section').hidden = !report;
    element('technical-details').hidden = !report && !error;
    if (report && asset) {
        text('stage-badge', hardBlocked ? 'Source needs updating' : identical ? 'Same artwork' : 'New candidate');
        const signature = `${state.selectedAsset}:${report.baselineSha256}:${report.candidateSha256}:${report.stagedAt}`;
        if (signature !== imageSignature) {
            imageSignature = signature;
            for (const [id, source] of [['current-artwork', '/images/current.png'], ['candidate-artwork', '/images/candidate.png']]) {
                const image = element(id); image.width = asset.width; image.height = asset.height; image.src = source;
            }
        }
    }
    element('review-button').disabled = pending || !report || hardBlocked;
    element('garden-section').hidden = !reviewed;
    element('approval-area').hidden = identical || approved;
    element('unchanged-note').hidden = !reviewed || !identical;
    element('review-note').disabled = pending || !reviewed || approved;
    const unexercised = reviewed && review.sourceExercised !== true;
    element('review-limitation').hidden = !unexercised;
    text('review-limitation', 'This artwork is not visible in the garden preview. It needs a matching preview before it can be approved.');
    element('approve-button').disabled = pending || !reviewed || identical || hardBlocked || unexercised || element('review-note').value.trim().length < 3;
    element('desktop-view').disabled = pending;
    element('mobile-view').disabled = pending;
    element('show-difference').disabled = pending;
    if (reviewed) showScene();

    element('submission-section').hidden = !approved;
    element('submit-button').hidden = submitted;
    element('submit-button').disabled = pending || !approved || submitted;
    text('submission-heading', submitted ? 'Review request ready' : 'Ready for the team');
    text('submission-description', submitted ? 'The team can review the artwork in dev. Nothing has been merged or deployed automatically.' : 'Opens a review request for dev. Nothing is merged or deployed automatically.');
    setLink(element('pull-request-link'), submitted ? safeExternal(state.pullRequestUrl, 'github.com') : null);
    text('detail-path', asset?.path);
    text('detail-baseline', report?.baselineSha256 || 'Not staged');
    text('detail-candidate', report?.candidateSha256 || 'Not staged');
    text('detail-renderer', review?.rendererSha256 || 'Preview not built');
    element('detail-error').hidden = !error; text('detail-error', error);
}

async function refresh() {
    clearTimeout(pollTimer);
    try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        if (!response.ok) throw new Error('The review page could not reconnect. Try refreshing the page.');
        state = await response.json();
        render();
    } catch (error) {
        text('error', error.message); element('error').hidden = false;
    } finally { pollTimer = setTimeout(refresh, state?.busy ? 1000 : 3000); }
}

async function post(path, body = {}, raw = false, revision = state?.revision) {
    if (busy() || !state?.token) return;
    posting = true; localError = ''; render();
    try {
        if (!Number.isInteger(revision)) throw new Error('Reconnect this page before changing artwork.');
        const response = await fetch(path, { method: 'POST', headers: { 'X-Review-Token': state.token, 'X-Review-Revision': String(revision), 'Content-Type': raw ? 'image/png' : 'application/json' }, body: raw ? body : JSON.stringify(body) });
        if (!response.ok) {
            let message = 'That action could not be completed. Please try again.';
            try { const result = await response.json(); message = typeof result.error === 'string' ? result.error : result.message || message; } catch { /* Keep the safe fallback message. */ }
            throw new Error(message);
        }
    } catch (error) { localError = error.message; }
    finally { posting = false; await refresh(); }
}

async function importFile(file) {
    if (busy() || !file) return;
    const asset = selected();
    const revision = state?.revision;
    try {
        if (!asset) throw new Error('Choose artwork before uploading a PNG.');
        if (file.size === 0 || file.size > 1024 * 1024) throw new Error('Choose a PNG smaller than 1 MB.');
        const bytes = await file.arrayBuffer();
        const header = new Uint8Array(bytes);
        if (header.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => header[index] === value)) throw new Error('This file is not a PNG. Export the linked artwork as a native 1× PNG.');
        const data = new DataView(bytes);
        const width = data.getUint32(16), height = data.getUint32(20);
        if (width !== asset.width || height !== asset.height) throw new Error(`This artwork needs ${asset.width} × ${asset.height} px. The chosen PNG is ${width} × ${height} px; export it at native 1× size.`);
        await post('/api/import', bytes, true, revision);
    } catch (error) { localError = error.message; render(); }
    finally { element('png-file').value = ''; }
}

element('asset-search').addEventListener('input', assetOptions);
element('asset-select').addEventListener('change', async event => {
    const asset = event.target.value;
    if (!asset || asset === state?.selectedAsset) return;
    element('asset-search').value = ''; element('review-note').value = '';
    imageSignature = sceneSignature = '';
    await post('/api/select', { asset });
});
element('pull-button').addEventListener('click', () => post('/api/pull'));
element('import-button').addEventListener('click', () => element('png-file').click());
element('png-file').addEventListener('change', event => importFile(event.target.files[0]));
element('review-button').addEventListener('click', () => post('/api/review'));
element('review-note').addEventListener('input', render);
element('approve-button').addEventListener('click', () => post('/api/approve', { note: element('review-note').value.trim() }));
element('submit-button').addEventListener('click', () => post('/api/submit'));
element('desktop-view').addEventListener('click', () => { view = 'desktop'; showScene(); });
element('mobile-view').addEventListener('click', () => { view = 'mobile'; showScene(); });
element('show-difference').addEventListener('change', showScene);
const dropZone = element('drop-zone');
for (const eventName of ['dragenter', 'dragover']) dropZone.addEventListener(eventName, event => { event.preventDefault(); if (!busy()) dropZone.classList.add('drag-over'); });
for (const eventName of ['dragleave', 'drop']) dropZone.addEventListener(eventName, event => { event.preventDefault(); dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop', event => {
    if (event.dataTransfer.files.length !== 1) { localError = 'Choose one PNG at a time.'; render(); return; }
    void importFile(event.dataTransfer.files[0]);
});
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
void refresh();
