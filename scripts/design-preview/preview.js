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
    status.textContent = report.blocked ? 'Blocked: this is the obsolete Figma placeholder. Keep the current repository artwork.'
        : report.identical ? 'Byte-identical: the Figma source matches the current repository.' : 'New artwork staged. Review the pixels and repeat seams before applying.';
    document.querySelectorAll('.pattern').forEach(element => { element.style.backgroundSize = `${report.width}px ${report.height}px`; });
    document.querySelector('#next').textContent = report.blocked ? 'Update the existing Figma source component, then pull again.' : `After approval: npm run design:apply -- ${report.asset}. Then run the checks and publish through the normal Git workflow.`;
    document.querySelector('#source').href = `https://www.figma.com/design/${report.fileKey}/cells.garden?node-id=${report.exportNodeId.replace(':', '-')}`;
}
showPreview().catch(error => { document.querySelector('#status').textContent = error.message; });
