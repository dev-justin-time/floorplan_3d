"use client";
import { jsxDEV } from "react/jsx-dev-runtime";
import { useState } from "react";
import { DEFAULT_TEXTURES } from "./textureLibrary.ts";
function CustomizationPanel({
  floorPlanData,
  roomHeight,
  onRoomHeightChange,
  roomColors,
  onRoomColorsChange,
  roomTextures,
  onRoomTexturesChange,
  wallThickness,
  onWallThicknessChange,
  lightIntensity,
  onLightIntensityChange
}) {
  const [activeTab, setActiveTab] = useState("rooms");
  const [selectedRoom, setSelectedRoom] = useState(
    floorPlanData?.rooms?.length > 0 ? floorPlanData.rooms[0].id : null
  );
  if (!floorPlanData || !floorPlanData.rooms) {
    return null;
  }
  const handleRoomColorChange = (roomId, color) => {
    onRoomColorsChange({
      ...roomColors,
      [roomId]: color
    });
  };
  const handleRoomTextureChange = (roomId, texture) => {
    onRoomTexturesChange({
      ...roomTextures,
      [roomId]: texture
    });
  };
  const handleApplyToAllRooms = (color) => {
    const newColors = { ...roomColors };
    floorPlanData.rooms.forEach((room) => {
      newColors[room.id] = color;
    });
    onRoomColorsChange(newColors);
  };
  const handleApplyTextureToAllRooms = (texture) => {
    const newTextures = { ...roomTextures };
    floorPlanData.rooms.forEach((room) => {
      newTextures[room.id] = texture;
    });
    onRoomTexturesChange(newTextures);
  };
  return /* @__PURE__ */ jsxDEV("div", { className: "bg-white p-6 rounded-lg shadow-md", children: [
    /* @__PURE__ */ jsxDEV("h2", { className: "text-xl font-semibold mb-4", children: "Customization" }, void 0, false, {
      fileName: "<stdin>",
      lineNumber: 75,
      columnNumber: 7
    }, this),
    /* @__PURE__ */ jsxDEV("div", { className: "flex border-b mb-4", children: [
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          className: `px-4 py-2 ${activeTab === "rooms" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"}`,
          onClick: () => setActiveTab("rooms"),
          children: "Rooms"
        },
        void 0,
        false,
        {
          fileName: "<stdin>",
          lineNumber: 78,
          columnNumber: 9
        },
        this
      ),
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          className: `px-4 py-2 ${activeTab === "walls" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"}`,
          onClick: () => setActiveTab("walls"),
          children: "Walls"
        },
        void 0,
        false,
        {
          fileName: "<stdin>",
          lineNumber: 84,
          columnNumber: 9
        },
        this
      ),
      /* @__PURE__ */ jsxDEV(
        "button",
        {
          className: `px-4 py-2 ${activeTab === "lighting" ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500"}`,
          onClick: () => setActiveTab("lighting"),
          children: "Lighting"
        },
        void 0,
        false,
        {
          fileName: "<stdin>",
          lineNumber: 90,
          columnNumber: 9
        },
        this
      )
    ] }, void 0, true, {
      fileName: "<stdin>",
      lineNumber: 77,
      columnNumber: 7
    }, this),
    activeTab === "rooms" && /* @__PURE__ */ jsxDEV("div", { children: [
      /* @__PURE__ */ jsxDEV("div", { className: "grid grid-cols-2 gap-4 mb-6", children: floorPlanData.rooms.map((room) => /* @__PURE__ */ jsxDEV(
        "div",
        {
          className: `border rounded-md p-3 cursor-pointer ${selectedRoom === room.id ? "ring-2 ring-blue-500" : ""}`,
          onClick: () => setSelectedRoom(room.id),
          children: [
            /* @__PURE__ */ jsxDEV("h3", { className: "font-medium", children: room.name }, void 0, false, {
              fileName: "<stdin>",
              lineNumber: 107,
              columnNumber: 17
            }, this),
            /* @__PURE__ */ jsxDEV("p", { className: "text-sm text-gray-500", children: [
              "Area: ",
              room.area,
              "m\xB2"
            ] }, void 0, true, {
              fileName: "<stdin>",
              lineNumber: 108,
              columnNumber: 17
            }, this),
            /* @__PURE__ */ jsxDEV("div", { className: "mt-2 flex items-center", children: [
              /* @__PURE__ */ jsxDEV(
                "div",
                {
                  className: "w-6 h-6 rounded-full mr-2",
                  style: { backgroundColor: roomColors[room.id] || "#ffffff" }
                },
                void 0,
                false,
                {
                  fileName: "<stdin>",
                  lineNumber: 110,
                  columnNumber: 19
                },
                this
              ),
              /* @__PURE__ */ jsxDEV("span", { className: "text-sm", children: roomColors[room.id] || "Default" }, void 0, false, {
                fileName: "<stdin>",
                lineNumber: 114,
                columnNumber: 19
              }, this)
            ] }, void 0, true, {
              fileName: "<stdin>",
              lineNumber: 109,
              columnNumber: 17
            }, this)
          ]
        },
        room.id,
        true,
        {
          fileName: "<stdin>",
          lineNumber: 102,
          columnNumber: 15
        },
        this
      )) }, void 0, false, {
        fileName: "<stdin>",
        lineNumber: 100,
        columnNumber: 11
      }, this),
      selectedRoom && /* @__PURE__ */ jsxDEV("div", { className: "space-y-4", children: [
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Room Color" }, void 0, false, {
            fileName: "<stdin>",
            lineNumber: 123,
            columnNumber: 17
          }, this),
          /* @__PURE__ */ jsxDEV("div", { className: "flex items-center", children: [
            /* @__PURE__ */ jsxDEV(
              "input",
              {
                type: "color",
                value: roomColors[selectedRoom] || "#ffffff",
                onChange: (e) => handleRoomColorChange(selectedRoom, e.target.value),
                className: "w-10 h-10 rounded-md cursor-pointer"
              },
              void 0,
              false,
              {
                fileName: "<stdin>",
                lineNumber: 127,
                columnNumber: 19
              },
              this
            ),
            /* @__PURE__ */ jsxDEV(
              "button",
              {
                className: "ml-2 text-sm text-blue-600 hover:text-blue-800",
                onClick: () => handleApplyToAllRooms(roomColors[selectedRoom] || "#ffffff"),
                children: "Apply to all rooms"
              },
              void 0,
              false,
              {
                fileName: "<stdin>",
                lineNumber: 133,
                columnNumber: 19
              },
              this
            )
          ] }, void 0, true, {
            fileName: "<stdin>",
            lineNumber: 126,
            columnNumber: 17
          }, this)
        ] }, void 0, true, {
          fileName: "<stdin>",
          lineNumber: 122,
          columnNumber: 15
        }, this),
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Floor Texture" }, void 0, false, {
            fileName: "<stdin>",
            lineNumber: 143,
            columnNumber: 17
          }, this),
          /* @__PURE__ */ jsxDEV("div", { className: "grid grid-cols-4 gap-2", children: DEFAULT_TEXTURES.floors.map((texture) => /* @__PURE__ */ jsxDEV(
            "div",
            {
              className: `border rounded-md p-1 cursor-pointer ${roomTextures[selectedRoom] === texture.url ? "ring-2 ring-blue-500" : ""}`,
              onClick: () => handleRoomTextureChange(selectedRoom, texture.url),
              children: [
                /* @__PURE__ */ jsxDEV("div", { className: "bg-gray-100 h-16 mb-1 flex items-center justify-center text-xs text-gray-500", children: texture.name }, void 0, false, {
                  fileName: "<stdin>",
                  lineNumber: 155,
                  columnNumber: 23
                }, this),
                /* @__PURE__ */ jsxDEV("div", { className: "text-xs text-center truncate", children: texture.name }, void 0, false, {
                  fileName: "<stdin>",
                  lineNumber: 158,
                  columnNumber: 23
                }, this)
              ]
            },
            texture.id,
            true,
            {
              fileName: "<stdin>",
              lineNumber: 148,
              columnNumber: 21
            },
            this
          )) }, void 0, false, {
            fileName: "<stdin>",
            lineNumber: 146,
            columnNumber: 17
          }, this),
          /* @__PURE__ */ jsxDEV(
            "button",
            {
              className: "mt-2 text-sm text-blue-600 hover:text-blue-800",
              onClick: () => handleApplyTextureToAllRooms(roomTextures[selectedRoom] || DEFAULT_TEXTURES.floors[0].url),
              children: "Apply texture to all rooms"
            },
            void 0,
            false,
            {
              fileName: "<stdin>",
              lineNumber: 162,
              columnNumber: 17
            },
            this
          )
        ] }, void 0, true, {
          fileName: "<stdin>",
          lineNumber: 142,
          columnNumber: 15
        }, this)
      ] }, void 0, true, {
        fileName: "<stdin>",
        lineNumber: 121,
        columnNumber: 13
      }, this)
    ] }, void 0, true, {
      fileName: "<stdin>",
      lineNumber: 99,
      columnNumber: 9
    }, this),
    activeTab === "walls" && /* @__PURE__ */ jsxDEV("div", { className: "space-y-4", children: [
      /* @__PURE__ */ jsxDEV("div", { children: [
        /* @__PURE__ */ jsxDEV("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: [
          "Wall Height: ",
          roomHeight,
          "m"
        ] }, void 0, true, {
          fileName: "<stdin>",
          lineNumber: 177,
          columnNumber: 13
        }, this),
        /* @__PURE__ */ jsxDEV(
          "input",
          {
            type: "range",
            min: "2",
            max: "4",
            step: "0.1",
            value: roomHeight,
            onChange: (e) => onRoomHeightChange(parseFloat(e.target.value)),
            className: "w-full"
          },
          void 0,
          false,
          {
            fileName: "<stdin>",
            lineNumber: 180,
            columnNumber: 13
          },
          this
        )
      ] }, void 0, true, {
        fileName: "<stdin>",
        lineNumber: 176,
        columnNumber: 11
      }, this),
      /* @__PURE__ */ jsxDEV("div", { children: [
        /* @__PURE__ */ jsxDEV("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: [
          "Wall Thickness: ",
          wallThickness,
          "m"
        ] }, void 0, true, {
          fileName: "<stdin>",
          lineNumber: 192,
          columnNumber: 13
        }, this),
        /* @__PURE__ */ jsxDEV(
          "input",
          {
            type: "range",
            min: "0.05",
            max: "0.3",
            step: "0.01",
            value: wallThickness,
            onChange: (e) => onWallThicknessChange(parseFloat(e.target.value)),
            className: "w-full"
          },
          void 0,
          false,
          {
            fileName: "<stdin>",
            lineNumber: 195,
            columnNumber: 13
          },
          this
        )
      ] }, void 0, true, {
        fileName: "<stdin>",
        lineNumber: 191,
        columnNumber: 11
      }, this),
      /* @__PURE__ */ jsxDEV("div", { children: [
        /* @__PURE__ */ jsxDEV("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Wall Texture" }, void 0, false, {
          fileName: "<stdin>",
          lineNumber: 207,
          columnNumber: 13
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "grid grid-cols-4 gap-2", children: DEFAULT_TEXTURES.walls.map((texture) => /* @__PURE__ */ jsxDEV(
          "div",
          {
            className: "border rounded-md p-1 cursor-pointer",
            children: [
              /* @__PURE__ */ jsxDEV("div", { className: "bg-gray-100 h-16 mb-1 flex items-center justify-center text-xs text-gray-500", children: texture.name }, void 0, false, {
                fileName: "<stdin>",
                lineNumber: 217,
                columnNumber: 19
              }, this),
              /* @__PURE__ */ jsxDEV("div", { className: "text-xs text-center truncate", children: texture.name }, void 0, false, {
                fileName: "<stdin>",
                lineNumber: 220,
                columnNumber: 19
              }, this)
            ]
          },
          texture.id,
          true,
          {
            fileName: "<stdin>",
            lineNumber: 212,
            columnNumber: 17
          },
          this
        )) }, void 0, false, {
          fileName: "<stdin>",
          lineNumber: 210,
          columnNumber: 13
        }, this)
      ] }, void 0, true, {
        fileName: "<stdin>",
        lineNumber: 206,
        columnNumber: 11
      }, this)
    ] }, void 0, true, {
      fileName: "<stdin>",
      lineNumber: 175,
      columnNumber: 9
    }, this),
    activeTab === "lighting" && /* @__PURE__ */ jsxDEV("div", { className: "space-y-4", children: [
      /* @__PURE__ */ jsxDEV("div", { children: [
        /* @__PURE__ */ jsxDEV("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: [
          "Light Intensity: ",
          lightIntensity
        ] }, void 0, true, {
          fileName: "<stdin>",
          lineNumber: 231,
          columnNumber: 13
        }, this),
        /* @__PURE__ */ jsxDEV(
          "input",
          {
            type: "range",
            min: "0.1",
            max: "2",
            step: "0.1",
            value: lightIntensity,
            onChange: (e) => onLightIntensityChange(parseFloat(e.target.value)),
            className: "w-full"
          },
          void 0,
          false,
          {
            fileName: "<stdin>",
            lineNumber: 234,
            columnNumber: 13
          },
          this
        )
      ] }, void 0, true, {
        fileName: "<stdin>",
        lineNumber: 230,
        columnNumber: 11
      }, this),
      /* @__PURE__ */ jsxDEV("div", { children: [
        /* @__PURE__ */ jsxDEV("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Light Color" }, void 0, false, {
          fileName: "<stdin>",
          lineNumber: 246,
          columnNumber: 13
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "flex space-x-2", children: [
          /* @__PURE__ */ jsxDEV("button", { className: "w-8 h-8 bg-white border rounded-full" }, void 0, false, {
            fileName: "<stdin>",
            lineNumber: 250,
            columnNumber: 15
          }, this),
          /* @__PURE__ */ jsxDEV("button", { className: "w-8 h-8 bg-yellow-100 border rounded-full" }, void 0, false, {
            fileName: "<stdin>",
            lineNumber: 251,
            columnNumber: 15
          }, this),
          /* @__PURE__ */ jsxDEV("button", { className: "w-8 h-8 bg-blue-100 border rounded-full" }, void 0, false, {
            fileName: "<stdin>",
            lineNumber: 252,
            columnNumber: 15
          }, this),
          /* @__PURE__ */ jsxDEV("button", { className: "w-8 h-8 bg-amber-200 border rounded-full" }, void 0, false, {
            fileName: "<stdin>",
            lineNumber: 253,
            columnNumber: 15
          }, this)
        ] }, void 0, true, {
          fileName: "<stdin>",
          lineNumber: 249,
          columnNumber: 13
        }, this)
      ] }, void 0, true, {
        fileName: "<stdin>",
        lineNumber: 245,
        columnNumber: 11
      }, this),
      /* @__PURE__ */ jsxDEV("div", { children: [
        /* @__PURE__ */ jsxDEV("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Shadows" }, void 0, false, {
          fileName: "<stdin>",
          lineNumber: 258,
          columnNumber: 13
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "flex items-center", children: [
          /* @__PURE__ */ jsxDEV("input", { type: "checkbox", id: "shadows", className: "mr-2" }, void 0, false, {
            fileName: "<stdin>",
            lineNumber: 262,
            columnNumber: 15
          }, this),
          /* @__PURE__ */ jsxDEV("label", { htmlFor: "shadows", children: "Enable shadows" }, void 0, false, {
            fileName: "<stdin>",
            lineNumber: 263,
            columnNumber: 15
          }, this)
        ] }, void 0, true, {
          fileName: "<stdin>",
          lineNumber: 261,
          columnNumber: 13
        }, this)
      ] }, void 0, true, {
        fileName: "<stdin>",
        lineNumber: 257,
        columnNumber: 11
      }, this)
    ] }, void 0, true, {
      fileName: "<stdin>",
      lineNumber: 229,
      columnNumber: 9
    }, this)
  ] }, void 0, true, {
    fileName: "<stdin>",
    lineNumber: 74,
    columnNumber: 5
  }, this);
}
export {
  CustomizationPanel as default
};
