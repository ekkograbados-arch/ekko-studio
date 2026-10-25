import { create } from 'zustand';

export type ObjectType = 'TEXT' | 'VECTOR' | 'IMAGE' | 'GROUP' | 'NONE';

interface SelectedObject {
  id: string;
  type: ObjectType;
  properties: any;
}

interface SelectionState {
  selectedObjects: SelectedObject[];
  selectionContext: ObjectType | 'MULTIPLE';
  setSelection: (objects: SelectedObject[]) => void;
  clearSelection: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedObjects: [],
  selectionContext: 'NONE',
  setSelection: (objects) => set({ 
    selectedObjects: objects,
    selectionContext: objects.length > 1 ? 'MULTIPLE' : (objects[0]?.type || 'NONE')
  }),
  clearSelection: () => set({ selectedObjects: [], selectionContext: 'NONE' }),
}));
