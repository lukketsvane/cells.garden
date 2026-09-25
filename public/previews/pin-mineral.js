const titles = ['Prepare the first playtest', 'Make room for new ideas', 'Share the next version'];
const key = 'cells.garden/prototype/mineral-notes';
let notes = ['- [ ] Invite two people\n- [ ] Watch one full session\n- Keep the first session short.', '', ''];
try { const saved = JSON.parse(localStorage.getItem(key)); if (Array.isArray(saved) && saved.length === 3 && saved.every(n => typeof n === 'string')) notes = saved; } catch { /* Keep the sample when storage is unavailable. */ }
let selected = 0;
const field = document.querySelector('#notes');
const panel = document.querySelector('aside');
const preview = document.querySelector('#preview');
function save() { notes[selected] = field.value; try { localStorage.setItem(key, JSON.stringify(notes)); } catch { /* Edits still work for this visit. */ } render(); }
function render() {
    preview.replaceChildren();
    field.value.split('\n').forEach((line, index) => {
        const match = /^- \[([ xX])\] (.*)$/.exec(line);
        const row = document.createElement(match ? 'label' : 'p');
        if (match) {
            const box = document.createElement('input'); box.type = 'checkbox'; box.checked = match[1] !== ' ';
            box.addEventListener('change', () => { const lines = field.value.split('\n'); lines[index] = `- [${box.checked ? 'x' : ' '}] ${match[2]}`; field.value = lines.join('\n'); save(); });
            row.append(box, document.createTextNode(match[2]));
        } else row.textContent = line.startsWith('- ') ? `• ${line.slice(2)}` : line;
        preview.append(row);
    });
}
function select(index) {
    selected = index; panel.hidden = false;
    document.querySelector('#title').textContent = titles[index]; field.value = notes[index];
    document.querySelectorAll('[data-mineral]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.mineral) === index)));
    render();
}
document.querySelectorAll('[data-mineral]').forEach(button => button.addEventListener('click', () => select(Number(button.dataset.mineral))));
document.querySelector('#unpin').addEventListener('click', () => { panel.hidden = true; document.querySelectorAll('[data-mineral]').forEach(button => button.setAttribute('aria-pressed', 'false')); });
field.addEventListener('input', save);
select(0);
