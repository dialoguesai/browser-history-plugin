// The cursor is a UI overlay. The approved app/toolbar artwork stays unchanged.
const sizes = [16, 20, 24, 32, 40, 48, 64, 128];
export const normalIcon = Object.fromEntries(sizes.map(size => [size, `icons/toolbar-${size}.png`]));
let agentImages;

export function drawAgentPointer(context, size) {
    context.save();
    context.scale(size / 32, size / 32);
    context.beginPath();
    context.moveTo(16, 15);
    context.lineTo(29, 20.3);
    context.lineTo(23.2, 23);
    context.lineTo(20.6, 29.2);
    context.closePath();
    context.lineJoin = 'round';
    context.fillStyle = '#111111';
    context.strokeStyle = '#111111';
    context.lineWidth = 3.4;
    context.stroke();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2.2;
    context.stroke();
    context.fill();
    context.restore();
}

async function renderAgentIcons() {
    return Object.fromEntries(await Promise.all(sizes.map(async size => {
        const response = await fetch(chrome.runtime.getURL(normalIcon[size]));
        if (!response.ok) throw new Error('Cannot load toolbar artwork.');
        const bitmap = await createImageBitmap(await response.blob());
        try {
            const canvas = new OffscreenCanvas(size, size);
            const context = canvas.getContext('2d');
            context.drawImage(bitmap, 0, 0, size, size);
            drawAgentPointer(context, size);
            return [size, context.getImageData(0, 0, size, size)];
        } finally { bitmap.close(); }
    })));
}

export async function toolbarIcon(kind) {
    if (kind !== 'agent' && kind !== 'automation') return { path: normalIcon };
    // Render once per worker lifetime, never per event or per tab switch.
    agentImages ||= renderAgentIcons().catch(error => { agentImages = null; throw error; });
    return { imageData: await agentImages };
}
