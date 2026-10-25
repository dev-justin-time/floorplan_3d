import React, { useState, useEffect, useCallback, useReducer } from 'react';
import { MOCK_DATA } from './test-data.js';
import LabScene from './LabScene.js';
import LabCustomizationPanel from './LabCustomizationPanel.js';
import LabUpload from './LabUpload.js';
import { RotateCcw, Undo, Redo, Save, Download, Upload, Play, Settings } from 'lucide-react';

const getRandomPastelColor = () => {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 70%, 80%)`;
};

// State Management Reducer
const initialState = {
  floorPlanData: null,
  roomHeight: 2.5,
  wallThickness: 0.15,
  lightIntensity: 1.0,
  roomColors: {},
  roomTextures: {},
  fixtures: [],
  selectedFixture: null,
  // NEW: Multiplayer state
  room: null,
  connectedUsers: {},
  myPresence: { cursorX: 0, cursorY: 0, selectedItemId: null }
};

const historyReducer = (state, action) => {
  const { past, present, future } = state;
  switch (action.type) {
    case 'UNDO':
      if (past.length === 0) return state;
      return {
        past: past.slice(0, past.length - 1),
        present: past[past.length - 1],
        future: [present, ...future]
      };
    case 'REDO':
      if (future.length === 0) return state;
      return {
        past: [...past, present],
        present: future[0],
        future: future.slice(1)
      };
    case 'SET':
      if (JSON.stringify(action.payload) === JSON.stringify(present)) return state;
      return {
        past: [...past, present],
        present: action.payload,
        future: []
      };
    case 'RESET':
      return {
        past: [],
        present: action.payload || initialState,
        future: []
      };
    default:
      return state;
  }
};

export default function LabApp() {
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: initialState,
    future: []
  });
  
  const { floorPlanData, roomHeight, wallThickness, lightIntensity, roomColors, roomTextures, fixtures, selectedFixture, room, connectedUsers, myPresence } = history.present;
  const [viewMode, setViewMode] = useState('3d');
  const [showSettings, setShowSettings] = useState(false);

  // NEW: Initialize WebsimSocket for multiplayer
  useEffect(() => {
    const initMultiplayer = async () => {
      const websimRoom = new WebsimSocket();
      await websimRoom.initialize();
      
      // Subscribe to presence (other users)
      websimRoom.subscribePresence((presence) => {
        updateState({ connectedUsers: presence });
      });
      
      // Subscribe to room state (shared floorplan data)
      websimRoom.subscribeRoomState((state) => {
        if (state.walls || state.fixtures) {
          updateState({
            floorPlanData: state.floorPlanData || floorPlanData,
            fixtures: state.fixtures || fixtures
          });
        }
      });
      
      updateState({ room: websimRoom });
    };
    
    initMultiplayer();
  }, []);

  // NEW: Sync local changes to multiplayer room
  useEffect(() => {
    if (room && floorPlanData) {
      room.updateRoomState({
        floorPlanData,
        fixtures,
        roomColors,
        roomTextures
      });
    }
  }, [floorPlanData, fixtures, roomColors, roomTextures, room]);

  // NEW: Update presence on cursor move
  const handleMouseMove = useCallback((e) => {
    if (room) {
      const rect = e.currentTarget.getBoundingClientRect();
      const cursorX = (e.clientX - rect.left) / rect.width;
      const cursorY = (e.clientY - rect.top) / rect.height;
      
      room.updatePresence({
        cursorX,
        cursorY,
        selectedItemId: selectedFixture?.id
      });
    }
  }, [room, selectedFixture]);

  // Persistence
  useEffect(() => {
    const saved = localStorage.getItem('lab_project_v1');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        dispatch({ type: 'RESET', payload: data });
      } catch (e) {
        console.error('Failed to load save', e);
      }
    } else {
      loadDemo();
    }
  }, []);

  useEffect(() => {
    if (history.present.floorPlanData) {
      localStorage.setItem('lab_project_v1', JSON.stringify(history.present));
    }
  }, [history.present]);

  const updateState = (updates) => {
    dispatch({ type: 'SET', payload: { ...history.present, ...updates } });
  };

  const loadDemo = useCallback(() => {
    const data = MOCK_DATA.simple_room;
    
    const initialColors = {};
    const initialTextures = {};
    if (data.rooms) {
      data.rooms.forEach(room => {
        initialColors[room.id] = getRandomPastelColor();
        initialTextures[room.id] = '/textures/wood_floor.jpg';
      });
    }

    dispatch({ type: 'RESET', payload: {
      ...initialState,
      floorPlanData: data,
      roomColors: initialColors,
      roomTextures: initialTextures
    }});
  }, []);

  const handleUpload = (result) => {
    const SCALE = 0.02; 
    const newWalls = [];
    if (result.walls) {
      result.walls.forEach((contour) => {
        for (let i = 1; i < contour.length; i++) {
           newWalls.push({
             start: { x: (contour[i-1][0] - result.width/2) * SCALE, y: (contour[i-1][1] - result.height/2) * SCALE },
             end: { x: (contour[i][0] - result.width/2) * SCALE, y: (contour[i][1] - result.height/2) * SCALE }
           });
        }
      });
    }
    const newData = {
      id: `upload_${Date.now()}`,
      rooms: [{ id: 'room_imported', name: 'Imported Floor Plan', walls: newWalls }]
    };
    
    const initialColors = { 'room_imported': getRandomPastelColor() };
    const initialTextures = { 'room_imported': '/textures/wood_floor.jpg' };

    dispatch({ type: 'SET', payload: {
      ...history.present,
      floorPlanData: newData,
      roomColors: initialColors,
      roomTextures: initialTextures,
      fixtures: []
    }});
  };

  const handleAddItem = (type) => {
    const newItem = {
      id: `item_${Date.now()}`,
      type,
      position: [0, 0, 0],
      rotation: 0
    };
    
    // NEW: Check if position is valid
    if (checkPlacementConstraints(newItem, newItem.position)) {
      updateState({ fixtures: [...(fixtures || []), newItem] });
    } else {
      // Find nearest valid position
      const validPosition = findNearestValidPosition(newItem, [0, 0, 0]);
      if (validPosition) {
        newItem.position = validPosition;
        updateState({ fixtures: [...(fixtures || []), newItem] });
      }
    }
  };

  // NEW: Find nearest valid position for object placement
  const findNearestValidPosition = useCallback((item, targetPos) => {
    const searchRadius = 5;
    const step = 0.5;
    
    for (let r = 0; r < searchRadius; r += step) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        const testPos = [
          targetPos[0] + Math.cos(angle) * r,
          0,
          targetPos[2] + Math.sin(angle) * r
        ];
        
        if (checkPlacementConstraints(item, testPos)) {
          return testPos;
        }
      }
    }
    
    return null;
  }, [checkPlacementConstraints]);

  const handleSelectFixture = (fixtureId) => {
    const fixture = fixtures?.find(f => f.id === fixtureId);
    updateState({ selectedFixture: fixture || null });
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(history.present, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'floorplan-project.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  // NEW: Smart placement constraint checking
  const checkPlacementConstraints = useCallback((item, position) => {
    // Check collision with walls
    const wallCollision = floorPlanData?.rooms?.some(room => 
      room.walls?.some(wall => {
        // Simple distance check - in production would use proper line-point distance
        const dist = Math.hypot(
          position[0] - (wall.start.x + wall.end.x) / 2,
          position[2] - (wall.start.y + wall.end.y) / 2
        );
        return dist < 0.5; // Too close to wall
      })
    );

    // Check collision with other fixtures
    const fixtureCollision = fixtures?.some(f => 
      f.id !== item.id && 
      Math.hypot(
        position[0] - f.position[0],
        position[2] - f.position[2]
      ) < 1.0 // Minimum distance between objects
    );

    return !wallCollision && !fixtureCollision;
  }, [floorPlanData, fixtures]);

  return React.createElement('main', { 
      className: 'min-h-screen p-4 md:p-6 bg-gray-50 dark:bg-black font-sans text-gray-900 dark:text-gray-100',
      onMouseMove: handleMouseMove
    },
    React.createElement('div', { className: 'max-w-7xl mx-auto' },
      // Header with user count
      React.createElement('div', { className: 'flex flex-col md:flex-row justify-between items-center mb-6 gap-4' },
        React.createElement('div', { className: 'flex items-center gap-4' },
           React.createElement('h1', { className: 'text-2xl md:text-3xl font-bold' }, 'React 3D Engine'),
           // NEW: Show connected users count
           room && Object.keys(connectedUsers).length > 0 && React.createElement('div', {
             className: 'flex items-center gap-2 px-3 py-1 bg-green-100 dark:bg-green-900/30 rounded-full text-sm'
           },
             React.createElement('span', { className: 'material-symbols-outlined text-green-600 text-sm' }, 'people'),
             React.createElement('span', { className: 'font-bold text-green-700 dark:text-green-400' }, 
               Object.keys(connectedUsers).length + ' online'
             )
           ),
           React.createElement('div', { className: 'flex gap-1 bg-white dark:bg-gray-800 rounded-lg p-1 border border-gray-200 dark:border-gray-700' },
              React.createElement('button', { 
                  onClick: () => dispatch({ type: 'UNDO' }), 
                  disabled: history.past.length === 0,
                  className: 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 transition-colors',
                  title: 'Undo'
              }, React.createElement(Undo, { className: 'w-4 h-4' })),
              React.createElement('button', { 
                  onClick: () => dispatch({ type: 'REDO' }), 
                  disabled: history.future.length === 0,
                  className: 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 transition-colors',
                  title: 'Redo'
              }, React.createElement(Redo, { className: 'w-4 h-4' })),
              React.createElement('button', { 
                  onClick: () => localStorage.setItem('lab_project_v1', JSON.stringify(history.present)), 
                  className: 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-blue-500 transition-colors',
                  title: 'Save'
              }, React.createElement(Save, { className: 'w-4 h-4' })),
              React.createElement('button', { 
                  onClick: handleExport, 
                  className: 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-green-500 transition-colors',
                  title: 'Export'
              }, React.createElement(Download, { className: 'w-4 h-4' }))
           )
        ),
        React.createElement('div', { className: 'flex items-center gap-2' },
           floorPlanData && React.createElement('button', {
            onClick: () => dispatch({ type: 'RESET', payload: initialState }),
            className: 'flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors'
          }, React.createElement(RotateCcw, { className: 'w-4 h-4' }), 'Reset'),
          !floorPlanData && React.createElement('button', {
            onClick: loadDemo,
            className: 'px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2'
          }, React.createElement(Play, { className: 'w-4 h-4' }), 'Load Demo')
        )
      ),
      
      !floorPlanData ? (
        React.createElement('div', { className: 'flex flex-col items-center justify-center min-h-[400px] bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8' },
          React.createElement(LabUpload, { onUpload: handleUpload })
        )
      ) : (
        React.createElement('div', { className: 'grid grid-cols-1 lg:grid-cols-3 gap-6' },
          // Left Column: Scene
          React.createElement('div', { className: 'lg:col-span-2 space-y-6' },
            React.createElement('div', { className: 'bg-white dark:bg-gray-900 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800' },
              React.createElement('div', { className: 'flex justify-between items-center mb-4' },
                React.createElement('div', { className: 'flex items-center gap-2' },
                    React.createElement('h2', { className: 'text-lg font-semibold' }, 'Live View'),
                    React.createElement('select', { 
                        onChange: (e) => { if(e.target.value) { handleAddItem(e.target.value); e.target.value = ''; } },
                        className: 'text-xs border rounded p-1 dark:bg-gray-800 dark:border-gray-700'
                    }, 
                        React.createElement('option', { value: '' }, '+ Add Item'),
                        React.createElement('option', { value: 'chair' }, 'Chair'),
                        React.createElement('option', { value: 'table' }, 'Table'),
                        React.createElement('option', { value: 'sofa' }, 'Sofa'),
                        React.createElement('option', { value: 'bed_queen' }, 'Bed'),
                        React.createElement('option', { value: 'door' }, 'Door'),
                        React.createElement('option', { value: 'window' }, 'Window')
                    )
                ),
                React.createElement('div', { className: 'flex space-x-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg' },
                  ['2d', '3d'].map(mode => 
                    React.createElement('button', {
                      key: mode,
                      className: `px-3 py-1 rounded-md text-xs font-bold transition-all ${
                        viewMode === mode 
                          ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-600 dark:text-indigo-400' 
                          : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                      }`,
                      onClick: () => setViewMode(mode)
                    }, mode.toUpperCase())
                  )
                )
              ),
              React.createElement(LabScene, {
                floorPlanData,
                height: roomHeight,
                wallThickness,
                roomColors,
                roomTextures,
                lightIntensity,
                viewMode,
                fixtures,
                selectedFixture,
                onSelectFixture: handleSelectFixture
              })
            ),
            // Advanced Stats Panel
            floorPlanData && React.createElement('div', { className: 'bg-white dark:bg-gray-900 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800' },
              React.createElement('h3', { className: 'text-sm font-bold mb-3 flex items-center gap-2' },
                React.createElement('span', { className: 'material-symbols-outlined text-sm text-blue-500' }, 'analytics'),
                'Project Statistics'
              ),
              React.createElement('div', { className: 'grid grid-cols-3 gap-4' },
                React.createElement('div', { className: 'text-center' },
                  React.createElement('div', { className: 'text-2xl font-bold text-indigo-600' }, floorPlanData.rooms?.length || 0),
                  React.createElement('div', { className: 'text-xs text-gray-500' }, 'Rooms')
                ),
                React.createElement('div', { className: 'text-center' },
                  React.createElement('div', { className: 'text-2xl font-bold text-purple-600' }, 
                    floorPlanData.rooms?.reduce((sum, r) => sum + (r.walls?.length || 0), 0) || 0
                  ),
                  React.createElement('div', { className: 'text-xs text-gray-500' }, 'Walls')
                ),
                React.createElement('div', { className: 'text-center' },
                  React.createElement('div', { className: 'text-2xl font-bold text-pink-600' }, fixtures?.length || 0),
                  React.createElement('div', { className: 'text-xs text-gray-500' }, 'Items')
                )
              )
            )
          ),
          
          // Right Column: Controls
          React.createElement('div', { className: 'lg:col-span-1 space-y-6' },
            React.createElement(LabCustomizationPanel, {
              roomHeight, onRoomHeightChange: (v) => updateState({ roomHeight: v }),
              roomColors, onRoomColorsChange: (v) => updateState({ roomColors: v }),
              roomTextures, onRoomTexturesChange: (v) => updateState({ roomTextures: v }),
              wallThickness, onWallThicknessChange: (v) => updateState({ wallThickness: v }),
              lightIntensity, onLightIntensityChange: (v) => updateState({ lightIntensity: v })
            }),
            // Selected Item Properties
            selectedFixture && React.createElement('div', { className: 'bg-white dark:bg-gray-900 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800' },
              React.createElement('h3', { className: 'text-sm font-bold mb-3 flex items-center gap-2' },
                React.createElement('span', { className: 'material-symbols-outlined text-sm text-orange-500' }, 'tune'),
                'Selected Item'
              ),
              React.createElement('div', { className: 'space-y-3' },
                React.createElement('div', null,
                  React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'Type'),
                  React.createElement('input', { 
                    type: 'text', 
                    value: selectedFixture.type, 
                    disabled: true,
                    className: 'w-full px-2 py-1 text-sm border rounded dark:bg-gray-800 dark:border-gray-700' 
                  })
                ),
                React.createElement('div', null,
                  React.createElement('label', { className: 'block text-xs text-gray-500 mb-1' }, 'Position'),
                  React.createElement('div', { className: 'grid grid-cols-3 gap-2' },
                    ['x', 'y', 'z'].map((axis, idx) =>
                      React.createElement('input', {
                        key: axis,
                        type: 'number',
                        value: selectedFixture.position[idx].toFixed(2),
                        step: '0.1',
                        onChange: (e) => {
                          const newPos = [...selectedFixture.position];
                          newPos[idx] = parseFloat(e.target.value);
                          const updated = fixtures.map(f => f.id === selectedFixture.id ? {...f, position: newPos} : f);
                          updateState({ fixtures: updated, selectedFixture: {...selectedFixture, position: newPos} });
                        },
                        className: 'w-full px-2 py-1 text-xs border rounded dark:bg-gray-800 dark:border-gray-700'
                      })
                    )
                  )
                ),
                React.createElement('button', {
                  onClick: () => {
                    const updated = fixtures.filter(f => f.id !== selectedFixture.id);
                    updateState({ fixtures: updated, selectedFixture: null });
                  },
                  className: 'w-full px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded text-sm font-medium transition-colors'
                }, 'Delete Item')
              )
            )
          )
        )
      )
    )
  );
}


