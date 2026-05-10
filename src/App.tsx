import React, { useEffect, useRef, useState } from 'react';
import { Upload, Download, Orbit, SlidersHorizontal, Image as ImageIcon } from 'lucide-react';
import { CadEngine } from './lib/CadEngine';
import { Toast } from './components/Toast';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<CadEngine | null>(null);
  
  const [hasModel, setHasModel] = useState(false);
  const [heightScale, setHeightScale] = useState(25);
  const [smoothing, setSmoothing] = useState(2);
  const [wireframe, setWireframe] = useState(false);
  const [modelColor, setModelColor] = useState('#ffffff');
  const [isDragging, setIsDragging] = useState(false);
  const [stats, setStats] = useState({ vertices: 0, resolution: '0 x 0' });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    
    // Initialize standard Three.js viewer
    engineRef.current = new CadEngine(containerRef.current);
    engineRef.current.onContentChanged = (newStats) => {
      setStats(newStats);
    };
    
    return () => {
      engineRef.current?.destroy();
    };
  }, []);

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.dxf')) {
      setToast({ message: 'Processing DXF...', type: 'info' });
      try {
        await engineRef.current?.loadFromDxf(file);
        setHasModel(true);
        setToast({ message: 'DXF imported successfully', type: 'success' });
      } catch (error) {
        console.error(error);
        setToast({ message: 'Failed to process DXF.', type: 'error' });
      }
      return;
    }

    if (!file.type.startsWith('image/')) {
      setToast({ message: 'Please upload a valid image or DXF file.', type: 'error' });
      return;
    }
    
    setToast({ message: 'Processing image...', type: 'info' });
    try {
      await engineRef.current?.loadFromFile(file, heightScale);
      setHasModel(true);
      setToast({ message: 'Terrain generated successfully', type: 'success' });
    } catch (error) {
      console.error(error);
      setToast({ message: 'Failed to process image.', type: 'error' });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setHeightScale(val);
    engineRef.current?.setHeightScale(val);
  };

  const handleSmoothingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setSmoothing(val);
    engineRef.current?.setSmoothing(val);
  };

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const color = e.target.value;
    setModelColor(color);
    engineRef.current?.setModelColor(color);
  };

  const toggleWireframe = () => {
    const next = !wireframe;
    setWireframe(next);
    engineRef.current?.setWireframe(next);
  };

  const handleExport = (format: 'stl' | 'obj' | 'dxf') => {
    if (!engineRef.current || !hasModel) return;
    
    setToast({ message: `Exporting ${format.toUpperCase()}...`, type: 'info' });
    
    setTimeout(() => {
      let blob: Blob | null = null;
      if (format === 'stl') blob = engineRef.current!.exportStl();
      if (format === 'obj') blob = engineRef.current!.exportObj();
      if (format === 'dxf') blob = engineRef.current!.exportDxf();
      
      if (!blob) {
        setToast({ message: 'Export failed.', type: 'error' });
        return;
      }
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `terrain.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      
      setToast({ message: `${format.toUpperCase()} exported successfully!`, type: 'success' });
    }, 50); // delay to let React render toast before heavy processing unblocks thread
  };

  return (
    <div 
      className="w-full h-screen bg-[#0B0C10] text-[#C5C6C7] font-sans flex flex-col overflow-hidden relative select-none"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Main 3D Viewport */}
      <main className="flex-1 w-full h-full relative overflow-hidden bg-[#0B0C10]">
        {!hasModel && (
           <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#66FCF1 0.5px, transparent 0.5px)', backgroundSize: '30px 30px' }}></div>
        )}
        
        <div ref={containerRef} className="absolute inset-0 outline-none cursor-grab active:cursor-grabbing" />
        
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0B0C10]/80 backdrop-blur-md border-2 border-dashed border-[#66FCF1] transition-all pointer-events-none">
            <div className="text-[#66FCF1] flex flex-col items-center gap-4">
              <Upload className="w-16 h-16 animate-bounce" />
              <h2 className="text-2xl font-bold uppercase tracking-widest text-white shadow-[#66FCF1]">Drop File to Generate 3D Model</h2>
            </div>
          </div>
        )}
      </main>

      {/* Toolbar / Side Panel (Moved to Bottom) */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 flex items-end gap-4 pointer-events-none w-full max-w-5xl justify-center px-4">
        
        <div className="bg-[#1F2833]/90 backdrop-blur-lg border border-[#45A29E]/30 p-2 rounded-2xl shadow-2xl flex items-center gap-4 pointer-events-auto overflow-x-auto">
          
          {/* Logo / Brand */}
          <div className="flex items-center gap-3 pl-2 pr-4 border-r border-white/10 shrink-0">
            <div className="w-8 h-8 bg-[#66FCF1] flex items-center justify-center rounded">
              <div className="w-4 h-4 bg-[#0B0C10] rotate-45"></div>
            </div>
            <span className="font-bold tracking-tight text-white uppercase text-sm hidden sm:block">Dimension.3D</span>
          </div>

          {/* Upload Button */}
          <label className="flex items-center justify-center h-14 px-6 border border-dashed border-[#45A29E] bg-[#0B0C10]/50 hover:bg-[#66FCF1]/10 rounded-xl cursor-pointer transition-all group">
            <input 
              type="file" 
              className="hidden" 
              accept="image/*,.dxf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = '';
              }}
            />
            <div className="flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-[#66FCF1]" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-white group-hover:text-[#66FCF1]">Upload File</span>
            </div>
          </label>

          {hasModel && (
            <div className="flex items-center gap-4 pl-4 border-l border-white/10 animate-in fade-in slide-in-from-bottom-4">
              
              {/* Mesh Displacement */}
              <div className="flex flex-col gap-1 pr-4 border-r border-white/10 shrink-0">
                <div className="flex justify-between items-center w-28">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-[#45A29E]">Displacement</span>
                  <span className="text-[10px] text-white font-mono">{heightScale}</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="100" 
                  value={heightScale} onChange={handleHeightChange}
                  className="w-28 h-1 bg-[#0B0C10] rounded-lg appearance-none cursor-pointer accent-[#66FCF1]" 
                />
              </div>

              {/* Smoothing */}
              <div className="flex flex-col gap-1 pr-4 border-r border-white/10 shrink-0">
                <div className="flex justify-between items-center w-24">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-[#45A29E]">Smoothing</span>
                  <span className="text-[10px] text-white font-mono">{smoothing}</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="10" 
                  value={smoothing} onChange={handleSmoothingChange}
                  className="w-24 h-1 bg-[#0B0C10] rounded-lg appearance-none cursor-pointer accent-[#66FCF1]" 
                />
              </div>

              {/* Color Picker */}
              <div className="flex flex-col gap-1 pr-4 border-r border-white/10 shrink-0">
                 <span className="text-[9px] font-bold uppercase tracking-widest text-[#45A29E]">Color</span>
                 <div className="flex items-center gap-2">
                    <input 
                      type="color" 
                      value={modelColor}
                      onChange={handleColorChange}
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                    />
                 </div>
              </div>

              {/* Render Mode */}
              <div className="flex gap-2 pr-4 border-r border-white/10">
                <button 
                   onClick={() => { if(wireframe) toggleWireframe(); }}
                   className={`px-3 py-1.5 text-[10px] rounded shadow-sm uppercase font-bold tracking-wider transition-colors ${!wireframe ? 'bg-[#66FCF1] text-[#0B0C10]' : 'bg-[#0B0C10] text-gray-400 hover:text-white'}`}
                >
                  Surface
                </button>
                <button 
                   onClick={() => { if(!wireframe) toggleWireframe(); }}
                   className={`px-3 py-1.5 text-[10px] rounded shadow-sm uppercase font-bold tracking-wider transition-colors ${wireframe ? 'bg-[#66FCF1] text-[#0B0C10]' : 'bg-[#0B0C10] text-gray-400 hover:text-white'}`}
                >
                  Wireframe
                </button>
              </div>

              {/* Export Panel */}
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => handleExport('obj')}
                  className="w-10 h-10 flex items-center justify-center bg-[#0B0C10] text-[#66FCF1] border border-[#45A29E] rounded-xl hover:bg-[#45A29E] hover:text-white transition-colors"
                  title="Export OBJ"
                >
                  <span className="text-[10px] font-bold">OBJ</span>
                </button>
                <button 
                  onClick={() => handleExport('stl')}
                  className="w-10 h-10 flex items-center justify-center bg-[#0B0C10] text-[#66FCF1] border border-[#45A29E] rounded-xl hover:bg-[#45A29E] hover:text-white transition-colors"
                  title="Export STL"
                >
                  <span className="text-[10px] font-bold">STL</span>
                </button>
                <button 
                  onClick={() => handleExport('dxf')}
                  className="w-10 h-10 flex items-center justify-center bg-[#0B0C10] text-[#66FCF1] border border-[#45A29E] rounded-xl hover:bg-[#45A29E] hover:text-white transition-colors"
                  title="Export DXF"
                >
                  <span className="text-[10px] font-bold">DXF</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Status Bar */}
      <footer className="absolute bottom-0 left-0 right-0 h-6 bg-[#0B0C10]/80 backdrop-blur border-t border-white/5 flex items-center justify-between px-4 text-[9px] text-[#45A29E] z-20">
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <span className="opacity-70 uppercase">Resolution:</span>
            <span className="text-white font-mono">{stats.resolution}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="opacity-70 uppercase">Vertices:</span>
            <span className="text-white font-mono">{stats.vertices.toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-[#66FCF1] rounded-full animate-pulse shadow-[0_0_8px_#66FCF1]"></div>
            <span className="uppercase tracking-wider">High Accuracy WebGL Engine</span>
          </div>
        </div>
      </footer>

      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)} 
        />
      )}
    </div>
  );
}
