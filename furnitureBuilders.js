import * as THREE from 'three';

// --- Helpers ---
export const createMat = (color, metalness = 0, roughness = 0.9, map = null) => 
    new THREE.MeshStandardMaterial({ color, metalness, roughness, map });

// Helper to cleanly add a child mesh to a group at a specific position
const addChild = (group, mesh, x = 0, y = 0, z = 0) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
};

// --- Builders ---

export const buildDoor = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const frameMat = createMat(0xffffff, 0.1, 0.5);
    const doorMat = material || createMat(0x8b5a2b, 0.0, 0.8); // Default wood

    // Frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.05, height + 0.05, 0.15), frameMat);
    addChild(group, frame, 0, height / 2, 0);

    // Door slab
    const door = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.05), doorMat);
    addChild(group, door, 0, height / 2, 0.05);

    // Handle
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), createMat(0xffd700, 0.9, 0.1));
    addChild(group, handle, width * 0.35, height / 2, 0.08);
    
    return group;
};

export const buildWindow = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const alt = fixture?.metadata?.altitude || 1.0;
    const frameMat = createMat(0xffffff, 0.1, 0.5);
    
    // Outer frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.15), frameMat);
    addChild(group, frame, 0, 0, 0);

    // Realistic Glass (Transmission)
    const glassMat = new THREE.MeshPhysicalMaterial({ 
        color: 0x87ceeb, transparent: true, opacity: 0.2, roughness: 0.0, transmission: 0.9, thickness: 0.1 
    });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(width - 0.08, height - 0.08, 0.02), glassMat);
    addChild(group, glass, 0, 0, 0.06);

    // Muntins (crossbars) for realism
    if (width > 0.8 && height > 0.8) {
        const barH = new THREE.Mesh(new THREE.BoxGeometry(width - 0.08, 0.04, 0.03), frameMat);
        addChild(group, barH, 0, 0, 0.07);
        const barV = new THREE.Mesh(new THREE.BoxGeometry(0.04, height - 0.08, 0.03), frameMat);
        addChild(group, barV, 0, 0, 0.07);
    }

    group.position.y = alt;
    return group;
};

export const buildRoundWindow = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const r = width / 2;
    const alt = fixture?.metadata?.altitude || 1.5;
    const frameMat = createMat(0xffffff, 0.1, 0.5);
    
    const torus = new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 16, 32), frameMat);
    addChild(group, torus, 0, 0, 0);
    
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x87ceeb, transparent: true, opacity: 0.2, roughness: 0.0, transmission: 0.9, side: THREE.DoubleSide });
    const glass = new THREE.Mesh(new THREE.CircleGeometry(r - 0.02, 32), glassMat);
    addChild(group, glass, 0, 0, 0.02);

    group.position.y = alt;
    return group;
};

export const buildSofa = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const seatH = height * 0.5 || 0.45;
    const backH = height || 0.8;
    const armH = seatH + 0.15;
    const mat = material || createMat(0x556b2f, 0.0, 0.9); // Default fabric

    // Base
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width, seatH, depth), mat), 0, seatH / 2, 0);
    // Backrest
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width, backH - seatH, 0.2), mat), 0, seatH + (backH - seatH) / 2, -depth / 2 + 0.1);
    // Arms
    const armGeo = new THREE.BoxGeometry(0.2, armH - seatH, depth);
    addChild(group, new THREE.Mesh(armGeo, mat), -width / 2 + 0.1, seatH + (armH - seatH) / 2, 0);
    addChild(group, new THREE.Mesh(armGeo, mat), width / 2 - 0.1, seatH + (armH - seatH) / 2, 0);

    // Cushions (visual detail)
    const cushionMat = createMat(material?.color?.getHex() || 0x6b8e23, 0.0, 0.95);
    const cushionGeo = new THREE.BoxGeometry(width / 2 - 0.05, 0.15, depth - 0.1);
    addChild(group, new THREE.Mesh(cushionGeo, cushionMat), -width / 4, seatH + 0.075, 0);
    addChild(group, new THREE.Mesh(cushionGeo, cushionMat), width / 4, seatH + 0.075, 0);

    return group;
};

export const buildBed = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const mat = material || createMat(0x8b4513, 0.0, 0.8); // Wood frame
    
    // Frame
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, depth), mat), 0, 0.15, 0);

    // Mattress
    const mattressMat = createMat(0xffffff, 0.0, 0.9);
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width - 0.1, height * 0.6, depth - 0.1), mattressMat), 0, 0.3 + (height * 0.6) / 2, 0);

    // Headboard
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width, height * 1.2, 0.1), mat), 0, 0.3 + height * 0.6, -depth / 2 + 0.05);

    // Pillows
    const pillowMat = createMat(0xf0f0f0, 0.0, 1.0);
    const pillowGeo = new THREE.BoxGeometry(width * 0.35, 0.15, 0.5);
    addChild(group, new THREE.Mesh(pillowGeo, pillowMat), -width * 0.2, 0.3 + height * 0.6 + 0.075, -depth / 2 + 0.4);
    addChild(group, new THREE.Mesh(pillowGeo, pillowMat), width * 0.2, 0.3 + height * 0.6 + 0.075, -depth / 2 + 0.4);

    // Blanket
    const blanketMat = createMat(0x4682b4, 0.0, 0.9);
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width - 0.1, 0.05, depth * 0.6), blanketMat), 0, 0.3 + height * 0.6 + 0.025, depth * 0.2);

    return group;
};

export const buildStove = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const bodyMat = material || createMat(0x222222, 0.6, 0.4); // Stainless/Matte black
    
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), bodyMat), 0, height / 2, 0);

    // Oven door
    const doorMat = createMat(0x111111, 0.8, 0.2);
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width * 0.8, height * 0.6, 0.05), doorMat), 0, height * 0.35, depth / 2 + 0.025);
    
    // Handle
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, width * 0.6, 8), createMat(0xcccccc, 0.9, 0.1));
    handle.rotation.z = Math.PI / 2;
    addChild(group, handle, 0, height * 0.55, depth / 2 + 0.05);

    // Burners & Grates
    const burnerGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.02, 16);
    const burnerMat = createMat(0x111111, 0.8, 0.2);
    const positions = [[-width/3, -depth/3], [width/3, -depth/3], [-width/3, depth/3], [width/3, depth/3]];
    
    positions.forEach(([x, z]) => {
        addChild(group, new THREE.Mesh(burnerGeo, burnerMat), x, height + 0.01, z);
        const grate = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.01, 8, 16), createMat(0x333333, 0.9, 0.8));
        grate.rotation.x = Math.PI / 2;
        addChild(group, grate, x, height + 0.03, z);
    });

    return group;
};

export const buildFloorLamp = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const poleMat = material || createMat(0x333333, 0.8, 0.2);
    
    addChild(group, new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 16), poleMat), 0, 0.025, 0);
    addChild(group, new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, height, 8), poleMat), 0, height / 2, 0);
    
    // Shade
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0xffffee, side: THREE.DoubleSide, transparent: true, opacity: 0.85, roughness: 0.9 });
    addChild(group, new THREE.Mesh(new THREE.CylinderGeometry(width / 2, width / 2.5, 0.5, 16, 1, true), shadeMat), 0, height - 0.25, 0);
    
    // Bulb & Light
    addChild(group, new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffddaa })), 0, height - 0.3, 0);
    const light = new THREE.PointLight(0xffaa00, 0.8, 4);
    light.position.set(0, height - 0.3, 0);
    group.add(light);

    return group;
};

export const buildCoffeeTable = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const mat = material || createMat(0x8b5a2b, 0.0, 0.8);
    
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), mat), 0, height, 0);
    
    const legGeo = new THREE.CylinderGeometry(0.03, 0.03, height, 8);
    const legMat = createMat(0x222222, 0.8, 0.2);
    [[-width/2 + 0.1, -depth/2 + 0.1], [width/2 - 0.1, -depth/2 + 0.1], [-width/2 + 0.1, depth/2 - 0.1], [width/2 - 0.1, depth/2 - 0.1]].forEach(([x, z]) => {
        addChild(group, new THREE.Mesh(legGeo, legMat), x, height / 2, z);
    });
    return group;
};

export const buildDesk = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const mat = material || createMat(0xffffff, 0.1, 0.5);
    
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), mat), 0, height, 0);
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width * 0.3, height - 0.05, depth - 0.1), mat), width / 2 - width * 0.15, (height - 0.05) / 2, 0);
    
    // Drawer handles
    for(let i = 0; i < 3; i++) {
        addChild(group, new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), createMat(0x888888, 0.9, 0.1)), width / 2 - width * 0.15, height * (0.8 - i * 0.25), depth / 2 - 0.05 + 0.01);
    }
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(0.05, height - 0.05, depth - 0.1), mat), -width / 2 + 0.025, (height - 0.05) / 2, 0);
    return group;
};

export const buildBookshelf = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const mat = material || createMat(0x8b5a2b, 0.0, 0.8);
    
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(0.05, height, depth), mat), -width / 2 + 0.025, height / 2, 0);
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(0.05, height, depth), mat), width / 2 - 0.025, height / 2, 0);
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), mat), 0, 0.025, 0);
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), mat), 0, height - 0.025, 0);
    
    const numShelves = 4;
    const shelfGeo = new THREE.BoxGeometry(width - 0.1, 0.03, depth - 0.05);
    const bookColors = [0x8b0000, 0x00008b, 0x006400, 0x4b0082, 0x8b4513, 0x2f4f4f];
    
    for (let i = 1; i <= numShelves; i++) {
        const y = (height / (numShelves + 1)) * i;
        addChild(group, new THREE.Mesh(shelfGeo, mat), 0, y, 0);
        
        // Procedural books
        let currentX = -width / 2 + 0.1;
        while (currentX < width / 2 - 0.15) {
            const bookW = 0.03 + Math.random() * 0.05;
            const bookH = 0.2 + Math.random() * 0.15;
            const color = bookColors[Math.floor(Math.random() * bookColors.length)];
            addChild(group, new THREE.Mesh(new THREE.BoxGeometry(bookW, bookH, depth - 0.1), createMat(color, 0.0, 0.9)), currentX + bookW / 2, y + 0.015 + bookH / 2, 0);
            currentX += bookW + 0.01;
        }
    }
    return group;
};

export const buildKitchenCabinet = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const mat = material || createMat(0xffffff, 0.1, 0.5);
    
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat), 0, height / 2, 0);
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, 0.04, depth + 0.04), createMat(0x333333, 0.1, 0.2)), 0, height, 0); // Countertop
    
    const handleMat = createMat(0xcccccc, 0.9, 0.1);
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.02), handleMat), -width / 4, height / 2, depth / 2 + 0.02);
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.02), handleMat), width / 4, height / 2, depth / 2 + 0.02);
    return group;
};

export const buildDiningTable = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const mat = material || createMat(0x8b5a2b, 0.0, 0.8);
    
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), mat), 0, height, 0);
    
    if (width > 1.5) {
        // Legs
        const legGeo = new THREE.BoxGeometry(0.08, height, 0.08);
        [[-width/2 + 0.1, -depth/2 + 0.1], [width/2 - 0.1, -depth/2 + 0.1], [-width/2 + 0.1, depth/2 - 0.1], [width/2 - 0.1, depth/2 - 0.1]].forEach(([x, z]) => {
            addChild(group, new THREE.Mesh(legGeo, mat), x, height / 2, z);
        });
    } else {
        // Pedestal
        addChild(group, new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, height, 16), mat), 0, height / 2, 0);
        addChild(group, new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.6), mat), 0, 0.025, 0);
    }
    return group;
};

export const buildPottedPlant = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    addChild(group, new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.4, 12), createMat(0x8b4513, 0.0, 0.9)), 0, 0.2, 0); // Pot
    addChild(group, new THREE.Mesh(new THREE.CircleGeometry(0.18, 12), createMat(0x3b2f2f, 0.0, 1.0)).rotateX(-Math.PI / 2), 0, 0.39, 0); // Soil

    // Procedural leaves
    addChild(group, new THREE.Mesh(new THREE.DodecahedronGeometry(0.25), createMat(0x228b22, 0.0, 0.8)), 0, 0.6, 0);
    addChild(group, new THREE.Mesh(new THREE.DodecahedronGeometry(0.2), createMat(0x32cd32, 0.0, 0.8)), 0.15, 0.8, 0.1);
    addChild(group, new THREE.Mesh(new THREE.DodecahedronGeometry(0.18), createMat(0x228b22, 0.0, 0.8)), -0.1, 0.75, -0.1);
    return group;
};

export const buildRug = (width, height, depth, material, fixture) => {
    const isRound = fixture?.type === 'rug_round';
    const geo = isRound ? new THREE.CylinderGeometry(width / 2, width / 2, 0.02, 32) : new THREE.BoxGeometry(width, 0.02, depth);
    const mat = material || createMat(0x8b0000, 0.0, 1.0); // High roughness for fabric
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.01;
    mesh.receiveShadow = true;
    return mesh;
};

export const buildPainting = (width, height, depth, material, fixture) => {
    const group = new THREE.Group();
    const alt = fixture?.metadata?.altitude || 1.5;
    
    addChild(group, new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, height + 0.1, 0.05), createMat(0x333333, 0.1, 0.5)), 0, 0, 0); // Frame
    const canvas = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material || createMat(0xffffff, 0.0, 0.9));
    canvas.position.z = 0.03;
    group.add(canvas);
    
    group.position.y = alt;
    return group;
};

// Fallback
export const buildDefaultBox = (width, height, depth, material, fixture) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.y = fixture?.type?.includes('rug') ? 0.01 : height / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
};

// --- Factory Registry ---
export const FurnitureFactory = {
    'door': buildDoor,
    'window': buildWindow,
    'round_window': buildRoundWindow,
    'bathtub': (w, h, d, m, f) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w || 1.6, h || 0.5, d || 0.8), m || createMat(0xffffff, 0.1, 0.2));
        mesh.position.y = (h || 0.5) / 2;
        return mesh;
    },
    'toilet': (w, h, d, m, f) => {
        const group = new THREE.Group();
        const mat = m || createMat(0xffffff, 0.1, 0.2);
        addChild(group, new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.4, 16), mat), 0, 0.2, 0);
        addChild(group, new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.2), mat), 0, 0.55, -0.25);
        const seat = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 8, 16), mat);
        seat.rotation.x = Math.PI / 2;
        addChild(group, seat, 0, 0.42, 0.05);
        return group;
    },
    'sofa': buildSofa,
    'bed_queen': buildBed,
    'bed_single': buildBed,
    'stove': buildStove,
    'floor_lamp': buildFloorLamp,
    'coffee_table': buildCoffeeTable,
    'desk': buildDesk,
    'bookshelf': buildBookshelf,
    'kitchen_cabinet': buildKitchenCabinet,
    'dining_table': buildDiningTable,
    'potted_plant': buildPottedPlant,
    'rug_large': buildRug,
    'rug_round': buildRug,
    'painting': buildPainting,
};