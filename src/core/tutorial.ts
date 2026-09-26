import { emptyGarden, type Garden, type LayerItem } from './model';

// getRandomValues also works in embedded hosts where randomUUID is unavailable.
function randomId(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** A normal, editable plant. Removing it never changes how a saved garden loads. */
export function tutorialGarden(): Garden {
    const cell = (content: string, isComplete = false): LayerItem => ({
        id: `item_${randomId()}`, content, isComplete,
    });
    return {
        ...emptyGarden(),
        updatedAt: new Date().toISOString(),
        projects: [{
            id: `proj_${randomId()}`,
            name: 'Start here', seed: 'Start here',
            standby: false, hue: 0, order: 0, plantType: 'plant_1',
            flowers: [cell('Small wins bloom here. Make this garden your own.', true)],
            stem: [cell('Move a cell between layers: drag it, or use its Move to menu.')],
            roots: [cell('Double-click a cell to edit. On a phone, tap it twice.'),
                cell('Right-click or press and hold a cell for its menu.')],
            minerals: [cell('Add your first idea with + in any layer.'),
                cell('Add a project with + beside the board. The seed is its name.'),
                cell('This is an example plant. Edit it or use Recycle plant in its seed menu.')],
        }],
    };
}
