async function showPreview() {
    const response = await fetch('/report.json');
    if (!response.ok) throw new Error('Staging report is unavailable. Pull the artwork again.');
    const report = await response.json();
    for (const id of ['current', 'candidate']) {
        const image = document.getElementById(id);
        await image.decode();
        if (image.naturalWidth !== report.width || image.naturalHeight !== report.height) throw new Error('Image dimensions no longer match the mapping.');
    }
    document.querySelector('#details').textContent = `${report.path} · ${report.width} × ${report.height} px · staged ${report.stagedAt} · ${report.provenance?.kind ?? 'unspecified source'} · SHA256 ${report.candidateSha256}`;
    const status = document.querySelector('#status');
    status.dataset.blocked = String(report.blocked);
    status.textContent = report.hardBlocked ? 'Blocked: this obsolete artwork cannot be approved.'
        : report.identical ? 'Byte-identical: the staged artwork matches the current repository.' : 'Needs approval: changed artwork is staged, but the repository is untouched.';
    document.querySelectorAll('.pattern').forEach(element => { element.style.backgroundSize = `${report.width}px ${report.height}px`; });
    document.querySelector('#next').textContent = report.hardBlocked ? 'Use the current source component, not the obsolete placeholder.'
        : report.identical ? `Verify the match: npm run design:apply -- ${report.asset}. Identical artwork needs no file changes.`
            : 'Compare native pixels, repeat seams and the garden screenshots below. Nothing is accepted automatically.';
    document.querySelector('#source').href = `https://www.figma.com/design/${report.fileKey}/cells.garden?node-id=${report.exportNodeId.replace(':', '-')}`;
    const reviewResponse = await fetch('/review.json');
    if (!reviewResponse.ok) throw new Error('Visual review status is unavailable.');
    const { review, error } = await reviewResponse.json();
    const reviewStatus = document.querySelector('#review-status');
    reviewStatus.textContent = error ? `Review needs refreshing: ${error}`
        : review ? `Desktop and mobile screenshots from the actual renderer. ${review.sourceExercised ? 'The selected asset was exercised.' : 'This asset was not exercised; approval is unavailable.'}`
            : `Generate the current/candidate garden comparison: npm run design:review -- ${report.asset}`;
    const groups = new Map();
    for (const comparison of review?.comparisons ?? []) {
        const group = document.createElement('section');
        group.className = 'review-group';
        const heading = document.createElement('h3');
        heading.textContent = `${comparison.viewport}: ${comparison.changedPixels.toLocaleString()} changed pixels (${(comparison.changedRatio * 100).toFixed(2)}%)`;
        const pictures = document.createElement('div');
        pictures.className = 'comparison';
        group.append(heading, pictures);
        document.querySelector('#review-gallery').append(group);
        groups.set(comparison.viewport, pictures);
    }
    for (const [index, file] of (review?.files ?? []).entries()) {
        if (!file.path.endsWith('.png')) continue;
        const figure = document.createElement('figure');
        const caption = document.createElement('figcaption');
        caption.textContent = file.label ?? file.path;
        const image = document.createElement('img');
        image.src = `/review-files/${index}`;
        image.alt = caption.textContent;
        const link = document.createElement('a');
        link.href = image.src; link.target = '_blank'; link.rel = 'noopener';
        link.append(image);
        figure.append(caption, link);
        const viewport = file.label?.split(':')[0];
        (groups.get(viewport) ?? document.querySelector('#review-gallery')).append(figure);
    }
    const canApprove = review?.sourceExercised && !report.identical && !report.hardBlocked;
    document.querySelector('#approval-help').textContent = canApprove
        ? 'After inspecting the full comparison, use this command with your review rationale. Apply on a feature branch, then deliver through a reviewed dev request.'
        : report.identical ? 'No approval is needed for identical artwork.' : 'Approval is unavailable until a valid garden review exercises the candidate.';
    document.querySelector('#approval-command').textContent = canApprove
        ? `npm run design:approve -- ${report.asset} --sha256 ${report.candidateSha256} --note "Describe the reviewed visual change"` : '';
}
showPreview().catch(error => { document.querySelector('#status').textContent = error.message; });
