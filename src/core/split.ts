/** Canvas height during a split drag. Leave room for the actual divider and both panes. */
export function splitHeight(total: number, divider: number, wanted: number): number {
    if (!Number.isFinite(total) || total <= 0) return 0;
    const grip = Number.isFinite(divider) ? Math.max(0, Math.min(total, divider)) : 0;
    const available = total - grip;
    const minimum = Math.min(100, available / 2);
    const height = Number.isFinite(wanted) ? wanted : available / 2;
    return Math.max(minimum, Math.min(available - minimum, height));
}
