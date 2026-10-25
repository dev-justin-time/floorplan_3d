import { ITEM_METADATA } from './metadata.js';

export class Item {
    constructor(type, x, y, rotation = 0, id = null) {
        this.type = type;
        this.x = x;
        this.y = y;
        this.rotation = rotation;
        this.id = id || 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.metadata = ITEM_METADATA[type] || { color: 0x999999 };
        this.selected = false;
        this.visible = true;
        this.modelUrl = null; // Support for custom 3D models
    }
    
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    isValidPosition(x, y) {
        return true;
    }

    toJSON() {
        return {
            class: 'Item',
            type: this.type,
            x: this.x,
            y: this.y,
            rotation: this.rotation,
            id: this.id,
            modelUrl: this.modelUrl // Include in serialization
        };
    }
}

export class FloorItem extends Item {
    constructor(type, x, y, rotation, id) {
        super(type, x, y, rotation, id);
    }
}

export class InWallItem extends Item {
    constructor(type, x, y, rotation, id) {
        super(type, x, y, rotation, id);
        this.boundToWallId = null;
    }

    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    snapToWall(walls, threshold = 20) {
        let closest = null;
        let minDistance = Infinity;

        for (const wall of walls) {
            const { distance, x, y, angle } = this.calculateSnap(wall, this.x, this.y);
            if (distance < minDistance) {
                minDistance = distance;
                closest = { wall, x, y, angle };
            }
        }

        if (closest && minDistance < threshold) {
            this.x = closest.x;
            this.y = closest.y;
            this.rotation = closest.angle;
            this.boundToWallId = closest.wall.id;
            return true;
        } else {
            this.boundToWallId = null;
            return false;
        }
    }

    calculateSnap(wall, x, y) {
        const A = x - wall.start.x;
        const B = y - wall.start.y;
        const C = wall.end.x - wall.start.x;
        const D = wall.end.y - wall.start.y;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = lenSq !== 0 ? dot / lenSq : -1;

        param = Math.max(0, Math.min(1, param));

        const xx = wall.start.x + param * C;
        const yy = wall.start.y + param * D;

        const dx = x - xx;
        const dy = y - yy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(D, C);

        return { distance, x: xx, y: yy, angle };
    }

    toJSON() {
        const json = super.toJSON();
        json.class = 'InWallItem';
        json.boundToWallId = this.boundToWallId;
        return json;
    }
}

export class InWallFloorItem extends InWallItem {
    constructor(type, x, y, rotation, id) {
        super(type, x, y, rotation, id);
    }
    
    toJSON() {
        const json = super.toJSON();
        json.class = 'InWallFloorItem';
        return json;
    }
}

export class Wall {
    constructor(x1, y1, x2, y2, thickness = 10, id = null) {
        this.start = { x: x1, y: y1 };
        this.end = { x: x2, y: y2 };
        this.id = id || 'wall_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.thickness = thickness; // Display thickness
    }

    toJSON() {
        return {
            class: 'Wall',
            start: this.start,
            end: this.end,
            id: this.id,
            thickness: this.thickness
        };
    }

    static fromJSON(json) {
        return new Wall(json.start.x, json.start.y, json.end.x, json.end.y, json.thickness, json.id);
    }
}

export class ItemFactory {
    static create(type, x, y, rotation = 0, id = null) {
        const meta = ITEM_METADATA[type];
        if (!meta) return new Item(type, x, y, rotation, id);
        
        if (meta.type === 'in_wall') return new InWallItem(type, x, y, rotation, id);
        if (meta.type === 'in_wall_floor') return new InWallFloorItem(type, x, y, rotation, id);
        return new FloorItem(type, x, y, rotation, id);
    }

    static fromJSON(json) {
        let item;
        if (json.class === 'InWallItem') item = new InWallItem(json.type, json.x, json.y, json.rotation, json.id);
        else if (json.class === 'InWallFloorItem') item = new InWallFloorItem(json.type, json.x, json.y, json.rotation, json.id);
        else if (json.class === 'FloorItem') item = new FloorItem(json.type, json.x, json.y, json.rotation, json.id);
        else item = new Item(json.type, json.x, json.y, json.rotation, json.id);
        
        if (json.boundToWallId) item.boundToWallId = json.boundToWallId;
        if (json.modelUrl) item.modelUrl = json.modelUrl; // Restore custom model URL
        return item;
    }
}