const DEFAULT_TEXTURES = {
  floors: [
    { id: "marble", name: "Marble", url: "/textures/marble_floor.jpg" },
    { id: "wood", name: "Wood", url: "/textures/wood_floor.jpg" },
    { id: "tile", name: "Ceramic Tile", url: "/textures/ceramic_tile.jpg" },
    { id: "concrete", name: "Concrete", url: "/textures/concrete_floor.jpg" },
    { id: "stone", name: "Stone", url: "/textures/stone_floor.jpg" },
    { id: "carpet", name: "Carpet", url: "/textures/carpet.jpg" }
  ],
  walls: [
    { id: "marble", name: "Marble", url: "/textures/marble_wall.jpg" },
    { id: "wood", name: "Wood Paneling", url: "/textures/wood_wall.jpg" },
    { id: "tile", name: "Wall Tile", url: "/textures/wall_tile.jpg" },
    { id: "concrete", name: "Concrete", url: "/textures/concrete_wall.jpg" },
    { id: "stone", name: "Stone", url: "/textures/stone_wall.jpg" },
    { id: "paint", name: "Painted", url: "/textures/painted_wall.jpg" }
  ]
};
function detectRoomType(roomName) {
  const name = roomName.toLowerCase();
  if (name.includes("bath") || name.includes("toilet")) {
    return "bathroom";
  } else if (name.includes("kitchen")) {
    return "kitchen";
  } else if (name.includes("living") || name.includes("lounge")) {
    return "living";
  } else if (name.includes("bed")) {
    return "bedroom";
  } else if (name.includes("office") || name.includes("study")) {
    return "office";
  }
  return "generic";
}
function getRecommendedTextures(roomType) {
  const recommendations = {
    bathroom: { floor: "tile", wall: "tile" },
    kitchen: { floor: "tile", wall: "tile" },
    living: { floor: "wood", wall: "paint" },
    bedroom: { floor: "carpet", wall: "paint" },
    office: { floor: "wood", wall: "paint" },
    generic: { floor: "wood", wall: "paint" }
  };
  return recommendations[roomType] || recommendations.generic;
}
export {
  DEFAULT_TEXTURES,
  detectRoomType,
  getRecommendedTextures
};
