'use client';
import React from 'react';
import { useSelectionStore } from '@/store/useSelectionStore';

export const SpatialFloatingBar = () => {
  const { selectionContext } = useSelectionStore();
  if (selectionContext === 'NONE') return null;

  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 
                    flex gap-2 p-3 rounded-full bg-black/60 backdrop-blur-2xl 
                    border border-white/20 shadow-2xl z-[100] animate-in fade-in zoom-in duration-300">
      {selectionContext === 'TEXT' && (
        <>
          <button className="px-3 py-1 text-xs bg-white/10 hover:bg-blue-500 rounded-full transition-all">↔️ Espaciar</button>
          <button className="px-3 py-1 text-xs bg-white/10 hover:bg-blue-500 rounded-full transition-all">⤴️ Curvar</button>
        </>
      )}
    </div>
  );
};
