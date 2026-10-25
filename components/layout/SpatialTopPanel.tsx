'use client';
import React from 'react';
import { useSelectionStore } from '@/store/useSelectionStore';

export const SpatialTopPanel = () => {
  const { selectionContext } = useSelectionStore();

  return (
    <nav className="fixed top-5 left-1/2 -translate-x-1/2 w-[90%] max-w-6xl h-16 px-6 flex items-center justify-between 
                   bg-white/10 dark:bg-black/20 backdrop-blur-xl saturate-150 
                   border border-white/20 dark:border-white/10 rounded-full 
                   shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] z-50 transition-all duration-300">
      
      <div className="flex gap-2">
        <button className="px-4 py-2 rounded-full text-sm font-medium bg-blue-500 text-white">Proyecto</button>
        <button className="px-4 py-2 rounded-full text-sm font-medium hover:bg-white/10 transition-colors">Vista</button>
      </div>

      <div className="flex items-center gap-3 bg-black/10 dark:bg-white/10 px-4 py-2 rounded-full">
        <span className="text-xs uppercase opacity-60 font-bold tracking-wider">
          {selectionContext === 'TEXT' ? 'Texto' : selectionContext === 'VECTOR' ? 'Vector' : 'Sin selección'}
        </span>
        
        <div className="flex gap-2">
          {selectionContext === 'TEXT' && (
            <>
              <button className="p-2 hover:bg-white/10 rounded-lg"><b>B</b></button>
              <button className="p-2 hover:bg-white/10 rounded-lg"><i>I</i></button>
              <button className="px-3 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/50 rounded-lg text-xs">Vectorizar</button>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button className="px-4 py-2 rounded-full text-sm font-medium hover:bg-white/10 transition-colors">⚙️</button>
      </div>
    </nav>
  );
};
