/** Original tutorial plant, copied with fresh IDs and no sharing links. */
import { emptyGarden, type Garden, type LayerItem, type LayerName, type ProjectData } from './model';

export function tutorialPlant(id = `tutorial_${Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('')}`): ProjectData {
    const roots = [3, 11, 10, 13, 6, 3];
    const minerals = [21, 62, 57, 21, 38, 38, 27, 25, 84, 92, 20, 52, 37, 27];
    const cells = (layer: LayerName, lines: string[]): LayerItem[] => lines.map((content, i) => ({
        id: `${id}_${layer}_${i}`,
        content,
        isComplete: false,
        imagePath: layer === 'stem' ? `plant_1/stem/stem${i + 1}.png`
            : layer === 'flowers' ? `plant_1/flowers/flower${i % 9 + 1}.png`
                : layer === 'roots' ? `roots/root${roots[i]}.png` : `minerals/mineral${minerals[i]}.png`,
    }));
    return {
        id, name: 'Tutorial plant', seed: 'Tutorial plant',
        seedImagePath: 'seeds/seed1.png', plantType: 'plant_1', hue: 304, order: 0, standby: false,
        minerals: cells('minerals', [
            'This is a mineral',
            'Minerals are meant as your to-do list for the project',
            'So each mineral is a task or an idea',
            'Like "make a tutorial for cells.garden"',
            'Most of the action will probably happen down here',
            'When a task is complete you convert it from a mineral into a stem',
            'You do this either by dragging the cell/text box up to the stem section of the column,',
            'or by right clicking the cell or its image and choosing "convert to stem"',
            'Click the + sign at the top of each category to make a new cell',
            "There's also a menu up in the top left corner and a button to hide and show the lower section in the top right",
            'I hope you enjoy the garden as much as I do! ☆',
            'You can delete this plant via the seed ⠇menu button, or just delete its cells and change the name if you want to repurpose it',
        ]),
        roots: cells('roots', [
            'This is a root',
            'Roots are for writing your motivations',
            'Reasons why you want to do the project',
            'Since this system is flexible you can use each section as you like',
            'I sometimes write memos for the project here',
            'Example: "I want people to figure out how to use the garden"',
        ]),
        stem: cells('stem', [
            'This is the stem section',
            'Minerals down at the bottom bottom are tasks...',
            'When you complete a task, convert its mineral into a stem',
            'Your plants grow as your ideas are turned into actions',
            'Right below the stem section is the seed',
            'The seed is the name of the project',
            'Click the plus signs on the far left and right of the lower section to plant a new seed',
            'You can also right click its name or click the ⠇menu button next to it to change things about the plant',
            "next to the menu there's a button for sharing the plant, so others can view and edit with you",
        ]),
        flowers: cells('flowers', [
            'Welcome to the garden! ☘️',
            'This is the tutorial plant',
            'Plants in cells.garden represent projects',
            'A plant consists of a column of cells(text boxes) in the lower section',
            'And a corresponding plant image in the upper section',
            'Each cell in the lower section is represented as part of a plant based on where it is in the column',
            'Cells up here in the top part of the column are flowers',
            'Flowers are meant to show yourself that you finished something or that the project lead to something',
            "I sometimes feel like I'm just spinning my wheels without getting anywhere",
            "Flowers let me see at a glance where I've completed or achieved something",
            'For example: "finished making the tutorial!"',
            'Or: "I like that the tutorial is just a plant in the garden"',
            'Flowers can also just be celebration like: "Well done!"',
        ]),
    };
}

export function tutorialGarden(): Garden {
    return { ...emptyGarden(), projects: [tutorialPlant()], updatedAt: new Date().toISOString() };
}

const LEGACY_CELLS: Record<LayerName, readonly string[]> = {
    flowers: ['Small wins bloom here. Make this garden your own.'],
    stem: ['Move a cell between layers: drag it, or use its Move to menu.'],
    roots: ['Double-click a cell to edit. On a phone, tap it twice.',
        'Right-click or press and hold a cell for its menu.'],
    minerals: ['Add your first idea with + in any layer.',
        'Add a project with + beside the board. The seed is its name.',
        'This is an example plant. Edit it or use Recycle plant in its seed menu.'],
};

/** Upgrade only the exact, unedited seven-cell starter shipped before the original tutorial. */
export function upgradeLegacyTutorial(garden: Garden): Garden {
    let changed = false;
    const projects = garden.projects.map(project => {
        if (!project || !/^proj_[a-f0-9]{32}$/.test(project.id)
            || project.name !== 'Start here' || project.seed !== 'Start here'
            || project.plantType !== 'plant_1' || project.hue !== 0 || project.standby
            || project.seedImagePath || project.sharedPlantId || project.tags?.length) return project;
        for (const layer of Object.keys(LEGACY_CELLS) as LayerName[]) {
            const cells = project[layer], lines = LEGACY_CELLS[layer];
            if (!Array.isArray(cells) || cells.length !== lines.length || cells.some((cell, index) =>
                !cell || !/^item_[a-f0-9]{32}$/.test(cell.id) || cell.content !== lines[index]
                || cell.isComplete !== (layer === 'flowers') || cell.imagePath
                || cell.highlighted || cell.assignees?.length
                || Object.keys(cell).some(key => !['id', 'content', 'isComplete', 'imagePath', 'highlighted', 'assignees'].includes(key)))) return project;
        }
        changed = true;
        // Keep the plant's identity and position. Stable cell IDs make concurrent upgrades identical.
        return { ...project, ...tutorialPlant(project.id), order: project.order };
    });
    return changed ? { ...garden, projects } : garden;
}
