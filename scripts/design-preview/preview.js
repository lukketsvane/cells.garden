async function showPreview() {
    const response = await fetch('/report.json');
    if (!response.ok) throw new Error('Staging report is unavailable. Pull the artwork again.');
    const report = await response.json();
    for (const id of ['current', 'candidate']) {
        const image = document.getElementById(id);
        await image.decode();
        if (image.naturalWidth !== report.width || image.naturalHeight !== report.height) throw new Error('Image dimensions no longer match the mapping.');
    }
    document.querySelector('#details').textContent = `${report.path} · ${report.width} × ${report.height} px · pulled ${report.stagedAt}`;
    const status = document.querySelector('#status');
    status.dataset.blocked = String(report.blocked);
    status.textContent = report.blocked ? 'Blocked: Figma differs from the current repository. Keep the shipped artwork and correct Figma.'
        : report.identical ? 'Byte-identical: the Figma source matches the current repository.' : 'New artwork staged. Review the pixels and repeat seams before applying.';
    document.querySelectorAll('.pattern').forEach(element => { element.style.backgroundSize = `${report.width}px ${report.height}px`; });
    document.querySelector('#next').textContent = report.blocked ? 'Update the existing Figma source component, then pull again. Imports cannot change the current appearance.' : `Verify the match: npm run design:apply -- ${report.asset}. Identical artwork needs no file changes.`;
    document.querySelector('#source').href = `https://www.figma.com/design/${report.fileKey}/cells.garden?node-id=${report.exportNodeId.replace(':', '-')}`;
}
showPreview().catch(error => { document.querySelector('#status').textContent = error.message; });
