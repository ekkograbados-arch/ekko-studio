<template>
  <div 
    v-if="selectionContext !== 'NONE'"
    class="floating-spatial-bar" 
    :style="positionStyle"
  >
    <!-- BOTONES DINÁMICOS SEGÚN OBJETO -->
    <template v-if="selectionContext === 'TEXT'">
      <button class="pill-btn">↔️ Espaciar</button>
      <button class="pill-btn">⤴️ Curvar</button>
    </template>

    <template v-else-if="selectionContext === 'VECTOR'">
      <button class="pill-btn">📐 Escalar</button>
      <button class="pill-btn">🔄 Rotar</button>
      <button class="pill-btn">✂️ Simplificar</button>
    </template>

    <template v-else-if="selectionContext === 'MULTIPLE'">
      <button class="pill-btn">📏 Alinear Izq</button>
      <button class="pill-btn">📏 Alinear Cen</button>
      <button class="pill-btn">📏 Alinear Der</button>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useSelectionStore } from '@/store/selection';

const selectionStore = useSelectionStore();
const selectionContext = computed(() => selectionStore.selectionContext);

// Estas coordenadas deberían venir del evento de clic del objeto en el lienzo
const positionStyle = computed(() => {
  return {
    top: '50%', // Por defecto al centro, pero se actualizará dinámicamente
    left: '50%',
    transform: 'translate(-50%, -50%)'
  };
});
</script>

<style scoped>
.floating-spatial-bar {
  position: fixed;
  display: flex;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 40px;
  z-index: 2000;
  backdrop-filter: blur(30px);
  -webkit-backdrop-filter: blur(30px);
  background: rgba(40, 40, 40, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 20px 50px rgba(0,0,0,0.4);
  animation: emerge 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.pill-btn {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  padding: 6px 12px;
  border-radius: 15px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s ease;
}

.pill-btn:hover {
  background: #007AFF;
  transform: scale(1.1);
}

@keyframes emerge {
  from { opacity: 0; transform: translate(-50%, -40%) scale(0.8); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
</style>
