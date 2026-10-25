import { jsxDEV } from "react/jsx-dev-runtime";
import * as THREE from "three";
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
function FloorPlan3D({ floorPlanData, height, roomColors }) {
  const { rooms, walls, dimensions } = floorPlanData;
  const centerX = dimensions.width / 2;
  const centerY = dimensions.height / 2;
  return /* @__PURE__ */ jsxDEV("group", { position: [-centerX, 0, -centerY], children: [
    /* @__PURE__ */ jsxDEV("mesh", { rotation: [-Math.PI / 2, 0, 0], position: [centerX, 0, centerY], receiveShadow: true, children: [
      /* @__PURE__ */ jsxDEV("planeGeometry", { args: [dimensions.width, dimensions.height] }, void 0, false, {
        fileName: "<stdin>",
        lineNumber: 24,
        columnNumber: 9
      }, this),
      /* @__PURE__ */ jsxDEV("meshStandardMaterial", { color: "#f0f0f0" }, void 0, false, {
        fileName: "<stdin>",
        lineNumber: 25,
        columnNumber: 9
      }, this)
    ] }, void 0, true, {
      fileName: "<stdin>",
      lineNumber: 23,
      columnNumber: 7
    }, this),
    rooms.map((room) => /* @__PURE__ */ jsxDEV(
      Room3D,
      {
        room,
        height,
        color: roomColors[room.id] || "#ffffff"
      },
      room.id,
      false,
      {
        fileName: "<stdin>",
        lineNumber: 30,
        columnNumber: 9
      },
      this
    )),
    walls.map((wall, index) => /* @__PURE__ */ jsxDEV(
      Wall3D,
      {
        wall,
        height
      },
      `wall-${index}`,
      false,
      {
        fileName: "<stdin>",
        lineNumber: 40,
        columnNumber: 9
      },
      this
    ))
  ] }, void 0, true, {
    fileName: "<stdin>",
    lineNumber: 21,
    columnNumber: 5
  }, this);
}
function Room3D({ room, height, color }) {
  const roomRef = useRef(null);
  const shape = useMemo(() => {
    const shape2 = new THREE.Shape();
    const firstWall = room.walls[0];
    shape2.moveTo(firstWall.start.x, firstWall.start.y);
    room.walls.forEach((wall) => {
      shape2.lineTo(wall.end.x, wall.end.y);
    });
    return shape2;
  }, [room]);
  const geometry = useMemo(() => {
    const extrudeSettings = {
      steps: 1,
      depth: height,
      bevelEnabled: false
    };
    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }, [shape, height]);
  useFrame(() => {
    if (roomRef.current) {
      roomRef.current.rotation.x = -Math.PI / 2;
    }
  });
  return /* @__PURE__ */ jsxDEV("group", { ref: roomRef, children: [
    /* @__PURE__ */ jsxDEV("mesh", { geometry, castShadow: true, receiveShadow: true, children: /* @__PURE__ */ jsxDEV("meshStandardMaterial", { color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }, void 0, false, {
      fileName: "<stdin>",
      lineNumber: 91,
      columnNumber: 9
    }, this) }, void 0, false, {
      fileName: "<stdin>",
      lineNumber: 90,
      columnNumber: 7
    }, this),
    /* @__PURE__ */ jsxDEV("group", { position: [room.center.x, 0.1, room.center.y], children: /* @__PURE__ */ jsxDEV(
      "textMesh",
      {
        text: room.name,
        position: [0, height + 0.1, 0],
        color: "black",
        fontSize: 0.3
      },
      void 0,
      false,
      {
        fileName: "<stdin>",
        lineNumber: 96,
        columnNumber: 9
      },
      this
    ) }, void 0, false, {
      fileName: "<stdin>",
      lineNumber: 95,
      columnNumber: 7
    }, this)
  ] }, void 0, true, {
    fileName: "<stdin>",
    lineNumber: 89,
    columnNumber: 5
  }, this);
}
function Wall3D({ wall, height }) {
  const wallWidth = 0.1;
  const length = Math.sqrt(
    Math.pow(wall.end.x - wall.start.x, 2) + Math.pow(wall.end.y - wall.start.y, 2)
  );
  const position = [
    (wall.start.x + wall.end.x) / 2,
    height / 2,
    (wall.start.y + wall.end.y) / 2
  ];
  const angle = Math.atan2(
    wall.end.y - wall.start.y,
    wall.end.x - wall.start.x
  );
  return /* @__PURE__ */ jsxDEV("mesh", { position, rotation: [0, angle, 0], castShadow: true, receiveShadow: true, children: [
    /* @__PURE__ */ jsxDEV("boxGeometry", { args: [length, height, wallWidth] }, void 0, false, {
      fileName: "<stdin>",
      lineNumber: 129,
      columnNumber: 7
    }, this),
    /* @__PURE__ */ jsxDEV("meshStandardMaterial", { color: "#cccccc" }, void 0, false, {
      fileName: "<stdin>",
      lineNumber: 130,
      columnNumber: 7
    }, this),
    wall.hasOpening && /* @__PURE__ */ jsxDEV("mesh", { position: [0, 0, 0], rotation: [0, 0, 0], children: [
      /* @__PURE__ */ jsxDEV("boxGeometry", { args: [1, 2, wallWidth * 1.1] }, void 0, false, {
        fileName: "<stdin>",
        lineNumber: 135,
        columnNumber: 11
      }, this),
      /* @__PURE__ */ jsxDEV("meshStandardMaterial", { color: "#ffffff" }, void 0, false, {
        fileName: "<stdin>",
        lineNumber: 136,
        columnNumber: 11
      }, this)
    ] }, void 0, true, {
      fileName: "<stdin>",
      lineNumber: 134,
      columnNumber: 9
    }, this)
  ] }, void 0, true, {
    fileName: "<stdin>",
    lineNumber: 128,
    columnNumber: 5
  }, this);
}
function textMesh({ text, position, color, fontSize }) {
  return /* @__PURE__ */ jsxDEV("mesh", { position, children: [
    /* @__PURE__ */ jsxDEV("textGeometry", { args: [text, { size: fontSize, height: 0.01 }] }, void 0, false, {
      fileName: "<stdin>",
      lineNumber: 152,
      columnNumber: 7
    }, this),
    /* @__PURE__ */ jsxDEV("meshStandardMaterial", { color }, void 0, false, {
      fileName: "<stdin>",
      lineNumber: 153,
      columnNumber: 7
    }, this)
  ] }, void 0, true, {
    fileName: "<stdin>",
    lineNumber: 151,
    columnNumber: 5
  }, this);
}
export {
  FloorPlan3D as default
};
