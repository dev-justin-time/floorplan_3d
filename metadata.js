export const TEXTURES = {
    floors: {
        marble: '/textures/marble_floor.jpg',
        wood: '/textures/wood_floor.jpg',
        tile: '/textures/ceramic_tile.jpg',
        concrete: '/textures/concrete_floor.jpg',
        stone: '/textures/stone_floor.jpg',
        carpet: '/textures/carpet.jpg'
    },
    walls: {
        marble: '/textures/marble_wall.jpg',
        wood: '/textures/wood_wall.jpg',
        tile: '/textures/wall_tile.jpg',
        concrete: '/textures/concrete_wall.jpg',
        stone: '/textures/stone_wall.jpg',
        paint: '/textures/painted_wall.jpg'
    }
};

export const ITEM_METADATA = {
    // Structural
    door: { type: 'in_wall_floor', width: 1.0, depth: 0.15, height: 2.1, color: 0x8b4513 },
    window: { type: 'in_wall', width: 1.2, depth: 0.15, height: 1.2, color: 0x87ceeb, altitude: 0.9 },
    round_window: { type: 'in_wall', width: 1.0, depth: 0.15, height: 1.0, color: 0x87ceeb, altitude: 1.5, shape: 'circle' },
    
    // Bathroom
    bathtub: { type: 'floor', width: 1.6, depth: 0.8, height: 0.5, color: 0xffffff },
    toilet: { type: 'floor', width: 0.5, depth: 0.6, height: 0.8, color: 0xffffff },
    sink: { type: 'floor', width: 0.6, depth: 0.5, height: 0.85, color: 0xffffff },
    shower: { type: 'floor', width: 1.0, depth: 1.0, height: 2.2, color: 0xffffff },

    // Kitchen
    stove: { type: 'floor', width: 0.76, depth: 0.7, height: 0.9, color: 0x111111 },
    fridge: { type: 'floor', width: 0.9, depth: 0.8, height: 1.8, color: 0xdddddd },
    kitchen_cabinet: { type: 'floor', width: 0.6, depth: 0.6, height: 0.9, color: 0x8b5a2b },
    kitchen_sink: { type: 'floor', width: 0.9, depth: 0.6, height: 0.9, color: 0xdddddd },
    kitchen_island: { type: 'floor', width: 1.5, depth: 0.9, height: 0.9, color: 0xf5f5dc },

    // Living Room
    sofa: { type: 'floor', width: 2.2, depth: 0.9, height: 0.8, color: 0x555555 },
    armchair: { type: 'floor', width: 1.0, depth: 0.9, height: 0.8, color: 0x555555 },
    coffee_table: { type: 'floor', width: 1.2, depth: 0.6, height: 0.4, color: 0x8b4513 },
    tv_stand: { type: 'floor', width: 1.8, depth: 0.45, height: 0.5, color: 0x1a1a1a },

    // Bedroom
    bed_queen: { type: 'floor', width: 1.6, depth: 2.1, height: 0.6, color: 0xffffff },
    bed_single: { type: 'floor', width: 1.0, depth: 2.0, height: 0.6, color: 0xffffff },
    wardrobe: { type: 'floor', width: 1.2, depth: 0.6, height: 2.0, color: 0x5d4037 },
    nightstand: { type: 'floor', width: 0.5, depth: 0.4, height: 0.6, color: 0x5d4037 },

    // Office
    desk: { type: 'floor', width: 1.5, depth: 0.7, height: 0.75, color: 0x3e2723 },
    office_chair: { type: 'floor', width: 0.6, depth: 0.6, height: 1.1, color: 0x212121 },
    bookshelf: { type: 'floor', width: 0.9, depth: 0.35, height: 1.8, color: 0x5d4037 },

    // Dining Room
    dining_table: { type: 'floor', width: 1.8, depth: 0.9, height: 0.75, color: 0x5d4037 },
    dining_chair: { type: 'floor', width: 0.45, depth: 0.45, height: 0.95, color: 0x3e2723 },
    sideboard: { type: 'floor', width: 1.6, depth: 0.45, height: 0.85, color: 0x5d4037 },

    // Decor & Lighting
    rug_large: { type: 'floor', width: 3.0, depth: 2.0, height: 0.02, color: 0x800000 },
    rug_round: { type: 'floor', width: 1.5, depth: 1.5, height: 0.02, color: 0x4682b4 },
    floor_lamp: { type: 'floor', width: 0.4, depth: 0.4, height: 1.6, color: 0xffd700 },
    potted_plant: { type: 'floor', width: 0.5, depth: 0.5, height: 1.2, color: 0x228b22 },
    painting: { type: 'in_wall', width: 0.8, depth: 0.05, height: 0.6, color: 0xffffff, altitude: 1.5 },
    wall_lamp: { type: 'in_wall', width: 0.2, depth: 0.15, height: 0.3, color: 0xffd700, altitude: 1.8 },

    // Outdoor
    patio_table: { type: 'floor', width: 1.0, depth: 1.0, height: 0.7, color: 0x8b4513 },
    patio_chair: { type: 'floor', width: 0.6, depth: 0.6, height: 0.85, color: 0xf5f5dc },
    lounger: { type: 'floor', width: 0.7, depth: 2.0, height: 0.4, color: 0xffffff },

    // Example 3D model items
    shaker: { 
        type: 'floor', 
        width: 0.3, 
        depth: 0.3, 
        height: 0.4, 
        color: 0xcccccc,
        modelUrl: '/shaker.glb',
        scale: 1
    }
};


export const GLOBAL_CONFIG = {
    pixelsPerMeter: 30,
    wallHeight: 2.7,
    wallThickness: 0.15,
    roofPitch: 1.5,
    roofOverhang: 0.5
};


export const DEFAULT_TEXTURES = {
  floors: [
    { id: 'marble', name: 'Marble', url: '/textures/marble_floor.jpg' },
    { id: 'wood', name: 'Wood', url: '/textures/wood_floor.jpg' },
    { id: 'tile', name: 'Ceramic Tile', url: '/textures/ceramic_tile.jpg' },
    { id: 'concrete', name: 'Concrete', url: '/textures/concrete_floor.jpg' },
    { id: 'stone', name: 'Stone', url: '/textures/stone_floor.jpg' },
    { id: 'carpet', name: 'Carpet', url: '/textures/carpet.jpg' }
  ],
  walls: [
    { id: 'marble', name: 'Marble', url: '/textures/marble_wall.jpg' },
    { id: 'wood', name: 'Wood Paneling', url: '/textures/wood_wall.jpg' },
    { id: 'tile', name: 'Wall Tile', url: '/textures/wall_tile.jpg' },
    { id: 'concrete', name: 'Concrete', url: '/textures/concrete_wall.jpg' },
    { id: 'stone', name: 'Stone', url: '/textures/stone_wall.jpg' },
    { id: 'paint', name: 'Painted', url: '/textures/painted_wall.jpg' }
  ]
};

// Room type detection for auto-texture assignment
export function detectRoomType(roomName) {
  const name = roomName.toLowerCase();

  if (name.includes('bath') || name.includes('toilet')) {
    return 'bathroom';
  } else if (name.includes('kitchen')) {
    return 'kitchen';
  } else if (name.includes('living') || name.includes('lounge')) {
    return 'living';
  } else if (name.includes('bed')) {
    return 'bedroom';
  } else if (name.includes('office') || name.includes('study')) {
    return 'office';
  }

  return 'generic';
}

// Get recommended textures for room type
export function getRecommendedTextures(roomType) {
  const recommendations = {
    bathroom: { floor: 'tile', wall: 'tile' },
    kitchen: { floor: 'tile', wall: 'tile' },
    living: { floor: 'wood', wall: 'paint' },
    bedroom: { floor: 'carpet', wall: 'paint' },
    office: { floor: 'wood', wall: 'paint' },
    generic: { floor: 'wood', wall: 'paint' }
  };

  return recommendations[roomType] || recommendations.generic;
}

