/** Snapshot of the original Tutorial garden, copied with fresh IDs and no sharing links. */
import { emptyGarden, type Garden, type LayerItem, type LayerName, type ProjectData } from './model';

export function tutorialPlant(): ProjectData {
    const id = `tutorial_${Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('')}`;
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
            "And there's a button next to it to share a plant with someone and let them edit it with you",
            'This is a mineral',
            'Minerals are basically meant as your to-do list for the project',
            'So each mineral is a task',
            'Or an idea',
            'Like "make a tutorial for cells.garden"',
            'Most of the action will probably happen here',
            'When you complete a task you convert it from a mineral into a stem',
            'You do this either by dragging the cell/text box up to the stem section of the column,',
            'or by right clicking the cell or its image and choosing "convert to stem"',
            'Click the + sign at the top of each category to make a new cell',
            "Oh, also there's a menu up in the top left and a button in the top right to hide and show the lower section",
            'I hope you enjoy the garden as much as I do! ☆',
            'You can delete this plant via the seed ⠇menu, or just delete its cells and change the name if you want to repurpose it',
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
            'You can also right click it or click the ⠇menu next to its name to change things about the plant',
        ]),
        flowers: cells('flowers', [
            'Welcome to the garden! ☘️',
            'Each project is represented as a plant',
            'Each plant consists of a column of cells/ text boxes in the lower section',
            'And a corresponding plant image in the upper section',
            'The cells in this section are flowers',
            'Flowers like this are meant as celebration',
            "I sometimes feel like I'm just spinning my wheels without getting anything done",
            'Flowers are so you can see at a glance if your projects lead to any results',
            'For example: "I finished making the tutorial!"',
            'Or: "I like that the tutorial is just a plant in the garden"',
            'Flowers can also just be celebration like: "Well done!"',
        ]),
    };
}

export function tutorialGarden(): Garden {
    return { ...emptyGarden(), projects: [tutorialPlant()], updatedAt: new Date().toISOString() };
}
