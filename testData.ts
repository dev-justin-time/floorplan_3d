export interface FloorPlanPoint {
  x: number;
  y: number;
}

export interface FloorPlanWall {
  id: string;
  start: FloorPlanPoint;
  end: FloorPlanPoint;
  hasOpening?: boolean;
}

export interface FloorPlanRoom {
  id: string;
  name: string;
  type: string;
  walls: FloorPlanWall[];
  floorVertices: FloorPlanPoint[];
  center: FloorPlanPoint;
}

export interface MockFloorPlanData {
  id: string;
  version: string;
  dimensions: { width: number; height: number };
  rooms: FloorPlanRoom[];
  walls: FloorPlanWall[];
}

// Outline walls (metres) with a door opening in the shared partition.
const outerWalls: FloorPlanWall[] = [
  { id: 'wall_south', start: { x: 0, y: 0 }, end: { x: 12, y: 0 } },
  { id: 'wall_east', start: { x: 12, y: 0 }, end: { x: 12, y: 6 } },
  { id: 'wall_north', start: { x: 12, y: 6 }, end: { x: 0, y: 6 } },
  { id: 'wall_west', start: { x: 0, y: 6 }, end: { x: 0, y: 0 } },
  { id: 'wall_partition', start: { x: 8, y: 0 }, end: { x: 8, y: 6 }, hasOpening: true }
];

export const mockFloorPlanData: MockFloorPlanData = {
  id: 'mock_plan_01',
  version: '1.0',
  dimensions: { width: 12, height: 6 },
  rooms: [
    {
      id: 'living',
      name: 'Living Room',
      type: 'living',
      walls: [
        { id: 'living_south', start: { x: 0, y: 0 }, end: { x: 8, y: 0 } },
        { id: 'living_east', start: { x: 8, y: 0 }, end: { x: 8, y: 6 }, hasOpening: true },
        { id: 'living_north', start: { x: 8, y: 6 }, end: { x: 0, y: 6 } },
        { id: 'living_west', start: { x: 0, y: 6 }, end: { x: 0, y: 0 } }
      ],
      floorVertices: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 6 },
        { x: 0, y: 6 }
      ],
      center: { x: 4, y: 3 }
    },
    {
      id: 'bedroom',
      name: 'Bedroom',
      type: 'bedroom',
      walls: [
        { id: 'bedroom_south', start: { x: 8, y: 0 }, end: { x: 12, y: 0 } },
        { id: 'bedroom_east', start: { x: 12, y: 0 }, end: { x: 12, y: 6 } },
        { id: 'bedroom_north', start: { x: 12, y: 6 }, end: { x: 8, y: 6 } },
        { id: 'bedroom_west', start: { x: 8, y: 6 }, end: { x: 8, y: 0 }, hasOpening: true }
      ],
      floorVertices: [
        { x: 8, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 6 },
        { x: 8, y: 6 }
      ],
      center: { x: 10, y: 3 }
    }
  ],
  walls: outerWalls
};

export default mockFloorPlanData;
