import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { Save, FileText, Upload, Box, AlertCircle } from 'lucide-react';
import KitchenScene from './KitchenScene';
import Cutlist from './Cutlist';
import ControlPanel from './ControlPanel';
import ViewControls from './ViewControls';
import SceneLabPanel from './SceneLabPanel.jsx';

import LabPathfinding from './LabPathfinding.js';
import LabGLTFExport from './LabGLTFExport.js';
import LabDracoCompression from './LabDracoCompression.js';
import LabInstancing from './LabInstancing.js';
import LabPostProcessing from './LabPostProcessing.js';
import LabReactSpring from './LabReactSpring.js';
import LabUpload from './LabUpload.js';
import LabShaker3DViewer from './LabShaker3DViewer.js';
import LabShakerPhysics from './LabShakerPhysics.js';
import LabShakerAR from './LabShakerAR.js';
import LabR3FWebGPUFloorplan from './LabR3FWebGPUFloorplan.js';
import LabWebGPUReactDemo from './LabWebGPUReactDemo.js';

import { FloorPlanProcessor } from './floorPlanProcessor.js';

// Every lab keeps its own implementation; the panel either drives the merged
// version in the main scene or opens the original demo full size.
const LAB_COMPONENTS = {
  pathfinding: LabPathfinding,
  gltf: LabGLTFExport,
  draco: LabDracoCompression,
  instancing: LabInstancing,
  postfx: LabPostProcessing,
  spring: LabReactSpring,
  upload: LabUpload,
  viewer: LabShaker3DViewer,
  physics: LabShakerPhysics,
  ar: LabShakerAR,
  r3f: LabR3FWebGPUFloorplan,
  webgpu: LabWebGPUReactDemo
};

const LAB_LIST = [
  { key: 'pathfinding', label: 'Pathfinding' },
  { key: 'gltf', label: 'GLTF export' },
  { key: 'draco', label: 'DRACO' },
  { key: 'instancing', label: 'Instancing' },
  { key: 'postfx', label: 'Post FX' },
  { key: 'spring', label: 'Spring' },
  { key: 'upload', label: 'Upload plan' },
  { key: 'viewer', label: '3D viewer' },
  { key: 'physics', label: 'Shake' },
  { key: 'ar', label: 'AR' },
  { key: 'r3f', label: 'R3F plan' },
  { key: 'webgpu', label: 'WebGPU' }
];

export default function App() {
  // --- State Management ---
  const [cabinets, setCabinets] = useState([
    { id: 1, name: 'Base Cabinet 1', position: [-6, 1.75, -2], size: [2, 3.5, 2], color: '#8B4513', material: 'Hardwood' },
    { id: 2, name: 'Base Cabinet 2', position: [-4, 1.75, -2], size: [2, 3.5, 2], color: '#8B4513', material: 'Hardwood' },
    { id: 3, name: 'Wall Cabinet 1', position: [-5, 5, -2], size: [4, 2, 1.5], color: '#A0522D', material: 'Plywood' },
    { id: 4, name: 'Base Cabinet 3', position: [2, 1.75, -2], size: [3, 3.5, 2], color: '#8B4513', material: 'Hardwood' },
    { id: 5, name: 'Wall Cabinet 2', position: [3.5, 5, -2], size: [2, 2, 1.5], color: '#A0522D', material: 'Plywood' }
  ]);
  
  const [selectedCabinet, setSelectedCabinet] = useState(null);
  const [showLabels, setShowLabels] = useState(true);
  const [viewMode, setViewMode] = useState('3d'); // '3d' or '2d'
  
  const [project, setProject] = useState({
    clientName: 'New Client',
    jobName: 'Kitchen Project',
    room: { width: 20, depth: 12, height: 6 }
  });

  const [notification, setNotification] = useState(null);
  const [sidebarTab, setSidebarTab] = useState('design');
  const [openLab, setOpenLab] = useState(null);
  const exporters = useRef(null);

  // Merged lab abilities for the main scene. All opt-in, all default off.
  const [sceneLabs, setSceneLabs] = useState({
    effects: { bloom: false, dof: false, vignette: false },
    spring: false,
    instances: 0,
    shaker: { visible: false, shaking: false, intensity: 0.5 },
    agent: false
  });
  const updateSceneLabs = useCallback((patch) => {
    setSceneLabs((prev) => ({ ...prev, ...patch }));
  }, []);
  const agentCabinet = cabinets.find((cabinet) => cabinet.id === selectedCabinet) || null;
  
  // --- Refs ---
  const controlsRef = useRef(null);
  const fileInputRef = useRef(null);
  const floorPlanInputRef = useRef(null);

  // --- Effects ---
  useEffect(() => {
    try {
      const saved = localStorage.getItem('kitchen_design_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.cabinets)) setCabinets(parsed.cabinets);
        if (typeof parsed.showLabels === 'boolean') setShowLabels(parsed.showLabels);
        if (parsed.project?.room) setProject(prev => ({ ...prev, ...parsed.project }));
        showNotification('Design loaded from local storage', 'success');
      }
    } catch (error) {
      console.error('Error loading saved design:', error);
    }
  }, []);

  // --- Actions ---
  const showNotification = useCallback((message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const addCabinet = useCallback(() => {
    const newId = Math.max(0, ...cabinets.map(c => c.id)) + 1;
    const newCabinet = {
      id: newId,
      name: `Cabinet ${newId}`,
      position: [0, 1.75, 0], // Centered for better initial placement
      size: [2, 3.5, 2],
      color: '#8B4513',
      material: 'Hardwood'
    };
    setCabinets(prev => [...prev, newCabinet]);
    setSelectedCabinet(newId);
    showNotification('New cabinet added', 'success');
  }, [cabinets, showNotification]);

  const removeCabinet = useCallback(() => {
    if (selectedCabinet) {
      setCabinets(prev => prev.filter(c => c.id !== selectedCabinet));
      setSelectedCabinet(null);
      showNotification('Cabinet removed', 'info');
    }
  }, [selectedCabinet, showNotification]);

  const updateCabinet = useCallback((property, value) => {
    if (selectedCabinet) {
      setCabinets(prev => prev.map(cabinet =>
        cabinet.id === selectedCabinet ? { ...cabinet, [property]: value } : cabinet
      ));
    }
  }, [selectedCabinet]);

  const resetView = useCallback(() => {
    setSelectedCabinet(null);
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  }, []);

  const saveDesign = useCallback(() => {
    const payload = { 
      version: 1, 
      timestamp: new Date().toISOString(), 
      cabinets, 
      showLabels, 
      project 
    };
    try {
      localStorage.setItem('kitchen_design_v1', JSON.stringify(payload));
      
      // Trigger file download
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.jobName.replace(/\s+/g, '_').toLowerCase()}_design.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showNotification('Design saved successfully!', 'success');
    } catch (error) {
      console.error('Error saving design:', error);
      showNotification('Failed to save design', 'error');
    }
  }, [cabinets, showLabels, project, showNotification]);

  const onDesignFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (Array.isArray(data.cabinets)) setCabinets(data.cabinets);
        if (typeof data.showLabels === 'boolean') setShowLabels(data.showLabels);
        if (data.project?.room) setProject(prev => ({ ...prev, ...data.project }));
        
        setSelectedCabinet(null);
        if (controlsRef.current) controlsRef.current.reset();
        showNotification('Design loaded from file', 'success');
      } catch (error) {
        console.error('Error loading design file:', error);
        showNotification('Invalid design file', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  }, [showNotification]);

  // --- Floor Plan Import Integration ---
  const onFloorPlanImport = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    showNotification('Processing floor plan...', 'info');
    
    try {
      const processor = new FloorPlanProcessor();
      const result = await processor.processImage(file);

      // The processor reports pixel dimensions; convert to room units.
      setProject(prev => ({
        ...prev,
        room: {
          width: Math.max(4, Math.round(result.width / 10)),
          depth: Math.max(4, Math.round(result.height / 10)),
          height: prev.room.height
        }
      }));
      showNotification(`Floor plan processed: ${result.walls?.length || 0} wall segments`, 'success');
    } catch (error) {
      console.error('Error processing floor plan:', error);
      showNotification('Failed to process floor plan', 'error');
    } finally {
      e.target.value = '';
    }
  }, [showNotification]);

  // --- Render ---
  return (
    <div className="h-screen w-full bg-gray-50 flex flex-col overflow-hidden font-sans">
      
      {/* 1. Notification Toast */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-xl text-white font-medium flex items-center gap-2 transition-all duration-300 animate-in slide-in-from-top-2 ${
          notification.type === 'success' ? 'bg-green-600' : 
          notification.type === 'error' ? 'bg-red-600' : 'bg-blue-600'
        }`}>
          {notification.type === 'error' && <AlertCircle className="w-4 h-4" />}
          {notification.message}
        </div>
      )}

      {/* 2. Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-4 flex-shrink-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-md">
              <Box className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800 leading-tight">Kitchen Cabinet Designer</h1>
              <p className="text-xs text-gray-500 font-medium">3D Design Platform with NKBA Guidelines</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => floorPlanInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all text-sm font-medium"
            >
              <Upload className="w-4 h-4" />
              Import Floor Plan
            </button>
            <input 
              ref={floorPlanInputRef} 
              type="file" 
              accept="image/png, image/jpeg" 
              onChange={onFloorPlanImport} 
              className="hidden" 
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all text-sm font-medium"
            >
              <FileText className="w-4 h-4" />
              Load
            </button>
            <input 
              ref={fileInputRef} 
              type="file" 
              accept="application/json" 
              onChange={onDesignFile} 
              className="hidden" 
            />

            <button
              onClick={saveDesign}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm hover:shadow-md transition-all text-sm font-medium"
            >
              <Save className="w-4 h-4" />
              Save Design
            </button>
          </div>
        </div>
      </header>

      {/* 3. Main Content */}
      <main className="flex flex-1 overflow-hidden">
        
        {/* Left Pane: 3D Canvas */}
        <div className="flex-1 bg-gray-100 relative">
          <Canvas 
            shadows 
            dpr={[1, 2]}
            camera={{ position: [8, 6, 12], fov: 50 }}
            className="w-full h-full"
          >
            <KitchenScene
              cabinets={cabinets}
              selectedCabinet={selectedCabinet}
              onSelectCabinet={setSelectedCabinet}
              showLabels={showLabels}
              onControlsRef={controlsRef}
              room={project.room}
              viewMode={viewMode}
              effects={sceneLabs.effects}
              spring={sceneLabs.spring}
              instances={sceneLabs.instances}
              shaker={sceneLabs.shaker}
              agent={sceneLabs.agent}
              agentTarget={agentCabinet ? agentCabinet.position : null}
              exporters={exporters}
            />
          </Canvas>
          
          {/* Floating View Controls */}
          <div className="absolute top-4 left-4 z-10">
            <ViewControls 
              showLabels={showLabels} 
              setShowLabels={setShowLabels} 
              resetView={resetView}
              viewMode={viewMode}
              setViewMode={setViewMode}
            />
          </div>
        </div>

        {/* Right Pane: Controls, Cutlist and the lab abilities */}
        <aside className="w-96 bg-white border-l border-gray-200 flex flex-col shadow-xl z-20">
          <div className="flex border-b border-gray-200 flex-shrink-0">
            {['design', 'labs'].map((tab) => (
              <button
                key={tab}
                onClick={() => setSidebarTab(tab)}
                className={`flex-1 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${sidebarTab === tab ? 'text-cyan-700 border-b-2 border-cyan-500 bg-cyan-50/50' : 'text-gray-400 hover:text-gray-600'}`}
              >
                {tab === 'design' ? 'Design' : 'Scene Labs'}
              </button>
            ))}
          </div>

          {sidebarTab === 'design' ? (
            <>
              <ControlPanel
                project={project}
                setProject={setProject}
                selectedCabinet={selectedCabinet}
                cabinets={cabinets}
                addCabinet={addCabinet}
                removeCabinet={removeCabinet}
                updateCabinet={updateCabinet}
              />
              <div className="flex-1 overflow-y-auto border-t border-gray-200">
                <Cutlist cabinets={cabinets} />
              </div>
            </>
          ) : (
            <SceneLabPanel
              scene={sceneLabs}
              update={updateSceneLabs}
              exporters={exporters}
              labs={LAB_LIST}
              onOpenLab={setOpenLab}
              targetName={agentCabinet ? agentCabinet.name : null}
            />
          )}
        </aside>
        
      </main>

      {/* Demo labs that need their own canvas open here, unchanged. */}
      {openLab && LAB_COMPONENTS[openLab] && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setOpenLab(null)}>
          <div className="w-full max-w-5xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-white text-sm font-bold">{LAB_LIST.find((lab) => lab.key === openLab)?.label}</p>
              <button onClick={() => setOpenLab(null)} className="px-3 py-1 rounded-md bg-white/90 text-xs font-bold text-gray-800 hover:bg-white">Close</button>
            </div>
            {React.createElement(LAB_COMPONENTS[openLab], {
              onUpload: (result) => showNotification(`${result.walls.length} walls detected`, 'success')
            })}
          </div>
        </div>
      )}
    </div>
  );
}