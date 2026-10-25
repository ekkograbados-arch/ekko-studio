<template>
  <nav class="spatial-top-panel" :class="theme">
    <!-- Sección Izquierda: Global -->
    <div class="tool-group">
      <button class="spatial-btn active">Proyecto</button>
      <button class="spatial-btn">Vista</button>
    </div>

    <!-- Sección Central: Dinámica (El corazón de la UI) -->
    <div class="context-hub">
      <span class="context-label">{{ contextLabel }}</span>
      <div class="dynamic-controls">
        <!-- LÓGICA DE BOTONES SEGÚN OBJETO -->
        <template v-if="selectionContext === 'TEXT'">
          <button class="spatial-btn icon">B</button>
          <button class="spatial-btn icon">I</button>
          <button class="spatial-btn action">Vectorizar Texto</button>
        </template>

        <template v-else-if="selectionContext === 'VECTOR'">
          <button class="spatial-btn">Grosor</button>
          <button class="spatial-btn">Relleno</button>
          <button class="spatial-btn action">Unir Nodos</button>
        </template>

        <template v-else-if="selectionContext === 'MULTIPLE'">
          <button class="spatial-btn">Agrupar</button>
          <button class="spatial-btn">Alinear</button>
        </template>

        <template v-else>
          <span class="no-selection-text">Selecciona un objeto para editar</span>
        </template>
      </div>
    </div>

    <!-- Sección Derecha: Config -->
    <div class="tool-group">
      <button @click="toggleTheme" class="spatial-btn">
        {{ theme === 'dark' ? '☀️ Claro' : '🌙 Oscuro' }}
      </button>
    </div>
  </nav>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useSelectionStore } from '@/store/selection';

const selectionStore = useSelectionStore();
const theme = ref('dark');

const selectionContext = computed(() => selectionStore.selectionContext);

const contextLabel = computed(() => {
  switch (selectionStore.selectionContext) {
    case 'TEXT': return 'Texto Seleccionado';
    case 'VECTOR': return 'Vector Seleccionado';
    case 'MULTIPLE': return 'Múltiples Objetos';
    default: return 'Sin Selección';
  }
});

const toggleTheme = () => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
};
</script>

<style scoped>
.spatial-top-panel {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 1200px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-radius: 32px;
  z-index: 1000;
  backdrop-filter: blur(25px) saturate(180%);
  -webkit-backdrop-filter: blur(25px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 10px 40px rgba(0,0,0,0.2);
  transition: all 0.4s ease;
}

.dark { background: rgba(30, 30, 35, 0.7); color: white; }
.light { background: rgba(255, 255, 255, 0.7); color: #1d1d1f; border-color: rgba(0,0,0,0.1); }

.tool-group { display: flex; gap: 10px; }

.spatial-btn {
  background: transparent;
  border: none;
  padding: 8px 16px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: inherit;
}

.spatial-btn:hover { background: rgba(150, 150, 150, 0.2); transform: translateY(-1px); }
.spatial-btn.active { background: #007AFF; color: white; }
.spatial-btn.action { background: rgba(0, 122, 255, 0.2); color: #007AFF; border: 1px solid #007AFF; }

.context-hub {
  display: flex;
  align-items: center;
  gap: 15px;
  background: rgba(0, 0, 0, 0.1);
  padding: 6px 18px;
  border-radius: 25px;
}

.context-label { font-size: 12px; opacity: 0.6; text-transform: uppercase; }
.dynamic-controls { display: flex; gap: 8px; }
.no-selection-text { font-size: 13px; opacity: 0.5; font-style: italic; }
</style>
