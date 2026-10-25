import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type ObjectType = 'TEXT' | 'VECTOR' | 'IMAGE' | 'GROUP' | 'NONE';

export interface SelectedObject {
  id: string;
  type: ObjectType;
  properties: any;
}

export const useSelectionStore = defineStore('selection', () => {
  const selectedObjects = ref<SelectedObject[]>([]);

  const selectionContext = computed(() => {
    if (selectedObjects.value.length === 0) return 'NONE';
    if (selectedObjects.value.length > 1) return 'MULTIPLE';
    return selectedObjects.value[0].type;
  });

  function setSelection(objects: SelectedObject[]) {
    selectedObjects.value = objects;
  }

  function clearSelection() {
    selectedObjects.value = [];
  }

  return {
    selectedObjects,
    selectionContext,
    setSelection,
    clearSelection
  };
});
