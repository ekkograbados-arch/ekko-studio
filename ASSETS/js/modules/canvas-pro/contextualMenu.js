import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward, applyBrightnessContrast } from "./imageToolbar.js";
import { enterNodeEditMode, exitNodeEditMode } from "./nodeEditor.js";

// =========================================================================
// EKKO TELEMETRY & DIAGNOSTIC SYSTEM (F12 TRACING - v21)
// =========================================================================
if (typeof window !== 'undefined') {
  console.log("%c[EKKO TELEMETRY] Sistema de diagnóstico F12 iniciado. Registrando eventos de carga de SVG e interacción.", "color: #0284c7; font-weight: bold; background: #e0f2fe; padding: 4px 8px; border-radius: 6px;");
  setTimeout(() => {
    if (window.paper && paper.project && paper.project.activeLayer) {
      paper.project.activeLayer.on('child-add', (event) => {
        const item = event.item;
        if (!item || (item.data && (item.data.mockup || item.data.isMask))) return;
        setTimeout(() => {
          console.log("%c[EKKO SVG LOAD] Se detectó un nuevo elemento en el lienzo:", "color: #ea580c; font-weight: bold; background: #fff7ed; padding: 2px 6px; border-radius: 6px;");
          console.log(" - ID del elemento:", item.id);
          console.log(" - Clase del objeto:", item.constructor.name);
          console.log(" - Nombre/Etiqueta:", item.name || item.data?.label || "Sin etiqueta");
          if (item.children) console.log(" - Hijos directos:", item.children.map(c => c.constructor.name));
          console.log(" - Bounds:", item.bounds ? { x: Math.round(item.bounds.x), y: Math.round(item.bounds.y), width: Math.round(item.bounds.width), height: Math.round(item.bounds.height) } : "N/A");
        }, 50);
      });
    }
  }, 1000);
}

function getContentItem(item) {
  if (!item) return null;
  if (item.data?.clipGroup) {
    const content = item.children?.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
    if (content) return content;
    return item.children?.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup))) || item.children?.[1] || item.children?.[0] || item;
  }
  return item;
}

window.originalFontBackup = null;
let fontsCache = [];
let toolbarDragged = false;
let lastSelectedItem = null;
window.ekkoOuters = window.ekkoOuters || new Map();
window.ekkoHolesMap = window.ekkoHolesMap || new Map();

const dropdownStylesId = 'ekko-custom-dropdown-styles';
if (typeof document !== 'undefined' && !document.getElementById(dropdownStylesId)) {
  const styleEl = document.createElement('style');
  styleEl.id = dropdownStylesId;
  styleEl.textContent = `.custom-font-dropdown{position:relative;min-width:180px;height:34px;background:white;border:1px solid #ccc;border-radius:6px;user-select:none;display:inline-block;vertical-align:middle}.selected-font-trigger{display:flex;align-items:center;justify-content:space-between;padding:0 12px;height:100%;cursor:pointer;font-size:13px;color:#334155;font-weight:500}.font-dropdown-list{position:absolute;top:calc(100% + 4px);left:0;right:0;max-height:250px;overflow-y:auto;background:white;border:1px solid #cbd5e1;border-radius:6px;box-shadow:0 4px 6px -1px rgba(0,0,0,.1);z-index:100000;display:flex;flex-direction:column}.font-dropdown-list.hidden{display:none!important}`;
  document.head.appendChild(styleEl);
}

function removeOverlapTab(){const btn=document.getElementById('btnCtxSubtract');if(btn){btn.style.display='none';btn.remove();}}
function injectFontFaces(fonts){let styleEl=document.getElementById('ekko-dynamic-font-faces');if(!styleEl){styleEl=document.createElement('style');styleEl.id='ekko-dynamic-font-faces';document.head.appendChild(styleEl)}let cssRules='';fonts.forEach(font=>{cssRules+=`@font-face{font-family:"${font.family}";src:url("/ASSETS/fonts/${encodeURIComponent(font.file)}") format("woff2"),url("/ASSETS/fonts/${encodeURIComponent(font.file)}") format("truetype"),url("/ASSETS/fonts/${encodeURIComponent(font.file)}") format("opentype");font-display:swap}`});styleEl.textContent+=cssRules;}
function getSelectedTextString(){if(!window.selectedItem)return'EKKO Studio';const target=window.selectedItem.data?.clipGroup?getContentItem(window.selectedItem):window.selectedItem;if(!target)return'EKKO Studio';if(target instanceof paper.PointText)return target.content||'EKKO Studio';if(target.data?.isCurvedGroup||target.data?.isSpacedGroup)return target.data.textString||'EKKO Studio';return'EKKO Studio';}
function getSelectedFontFamily(){if(!window.selectedItem)return'Arial';const target=window.selectedItem.data?.clipGroup?getContentItem(window.selectedItem):window.selectedItem;if(!target)return'Arial';if(target instanceof paper.PointText)return target.fontFamily||'Arial';if(target.data?.isCurvedGroup||target.data?.isSpacedGroup)return target.data.fontFamily||'Arial';return'Arial';}
function applyFontFamily(item,family){if(!item)return;const target=item.data?.clipGroup?getContentItem(item):item;if(!target)return;if(target instanceof paper.PointText)target.fontFamily=family;else if(target.data?.isCurvedGroup){target.data.fontFamily=family;applyTextCurve(item,target.data.curvature||0)}else if(target.data?.isSpacedGroup){target.data.fontFamily=family;applyTextSpacing(item,target.data.hspace||0)}paper.view.update();}
function renderCustomFontItems(listContainer,fonts){listContainer.innerHTML='';const previewText=getSelectedTextString();const currentFamily=getSelectedFontFamily();fonts.forEach(font=>{const item=document.createElement('div');item.className='custom-font-item'+(currentFamily===font.family?' active':'');const preview=document.createElement('div');preview.className='custom-font-preview';preview.style.fontFamily=font.family;preview.textContent=previewText;const name=document.createElement('div');name.className='custom-font-name';name.textContent=font.name;item.appendChild(preview);item.appendChild(name);item.onmouseenter=()=>{if(window.selectedItem)applyFontFamily(window.selectedItem,font.family)};item.onmouseleave=()=>{if(window.selectedItem&&window.originalFontBackup)applyFontFamily(window.selectedItem,window.originalFontBackup)};item.onclick=e=>{e.stopPropagation();window.originalFontBackup=font.family;if(window.selectedItem){applyFontFamily(window.selectedItem,font.family);if(typeof window.saveHistory==='function')window.saveHistory()}listContainer.classList.add('hidden');const triggerText=document.querySelector('.selected-font-trigger span');if(triggerText)triggerText.textContent=font.name};listContainer.appendChild(item)})}
async function populateFontDropdowns(){let fonts=[];try{if(typeof loadDynamicFonts==='function')fonts=await loadDynamicFonts();else{const response=await fetch('/api/fonts');if(response.ok)fonts=await response.json()}}catch(err){console.error('Error al cargar las tipografias dinamicas en el menu contextual:',err)}fontsCache=fonts;injectFontFaces(fonts);const nativeSelect=document.getElementById('ctxFontSelector');if(nativeSelect){nativeSelect.style.display='none';nativeSelect.classList.add('hidden')}const customDropdown=document.querySelector('.custom-font-dropdown');if(customDropdown){const trigger=customDropdown.querySelector('.selected-font-trigger');const list=customDropdown.querySelector('.font-dropdown-list');if(trigger&&list){trigger.onclick=e=>{e.stopPropagation();document.querySelectorAll('.font-dropdown-list').forEach(el=>{if(el!==list)el.classList.add('hidden')});const isOpen=!list.classList.contains('hidden');if(!isOpen){window.originalFontBackup=getSelectedFontFamily();renderCustomFontItems(list,fontsCache);list.classList.remove('hidden')}else list.classList.add('hidden')};document.addEventListener('click',()=>list.classList.add('hidden'))}}}
function makeToolbarDraggable(){const toolbar=document.getElementById('contextual-toolbar');if(!toolbar)return;toolbar.addEventListener('mouseover',e=>{toolbar.style.cursor=(e.target.tagName==='BUTTON'||e.target.tagName==='INPUT'||e.target.closest('.custom-font-dropdown'))?'default':'move'});let dragging=false,startX=0,startY=0;toolbar.addEventListener('mousedown',e=>{if(e.target.tagName==='BUTTON'||e.target.tagName==='INPUT'||e.target.closest('.custom-font-dropdown'))return;dragging=true;startX=e.clientX-toolbar.offsetLeft;startY=e.clientY-toolbar.offsetTop;e.preventDefault()});document.addEventListener('mousemove',e=>{if(!dragging)return;const l=e.clientX-startX,t=e.clientY-startY;toolbar.style.left=l+'px';toolbar.style.top=t+'px';toolbarDragged=true;window.customToolbarLeft=l;window.customToolbarTop=t});document.addEventListener('mouseup',()=>dragging=false)}

function getLeafItemsRecursive(item){const leaves=[];const recurse=(node,parentMatrix)=>{const currentMatrix=parentMatrix?parentMatrix.chain(node.matrix):node.matrix.clone();if(node instanceof paper.Group&&!node.data?.clipGroup)node.children.forEach(child=>recurse(child,currentMatrix));else{node.data=node.data||{};node.data.globalMatrix=currentMatrix;leaves.push(node)}};recurse(item,null);return leaves;}

export function groupSelectedItems(){
  const selected=(window.selectedItems?.length>0)?[...window.selectedItems]:(window.selectedItem?[window.selectedItem]:[]);
  if(selected.length<2){alert('Selecciona al menos 2 elementos para poder agruparlos.');return;}
  if(selected.some(item=>item.data?.locked||item.data?.mockup)){alert('No se pueden agrupar objetos protegidos.');return;}
  if(typeof window.saveHistory==='function')window.saveHistory();
  const parent=selected[0].parent||paper.project.activeLayer;
  const index=parent.children.indexOf(selected[0]);
  const isClipped=selected.some(item=>!!item.data?.clipGroup);
  const contents=[];
  selected.forEach(item=>{let content;if(item.data?.clipGroup){content=getContentItem(item);if(content)content.remove()}else{content=item;content.remove()}if(content)contents.push(content);item.remove()});
  const newGroup=new paper.Group(contents);newGroup.data={...(newGroup.data||{}),locked:false,label:'Grupo',geometricHierarchy:'compound'};
  let finalItem;if(isClipped&&typeof window.clipItem==='function')finalItem=window.clipItem(newGroup);else{finalItem=newGroup;parent.addChild(finalItem)}
  if(finalItem.parent)finalItem.parent.insertChild(Math.max(0,index),finalItem);
  window.deselectItem();window.selectItem(finalItem);paper.view.update();
}

function getMatrixRelativeTo(item,targetAncestor){let matrix=new paper.Matrix();let current=item;while(current&&current!==targetAncestor&&!(current instanceof paper.Layer)){if(current.matrix)matrix=current.matrix.chain(matrix);current=current.parent}return matrix;}
function getGlobalMatrix(item){if(!item)return new paper.Matrix();if(item.data?.globalMatrix)return item.data.globalMatrix.clone();return getMatrixRelativeTo(item,null);}
function getActiveGroupTarget(group){let current=group;while(current instanceof paper.Group&&current.children.length===1&&!current.data?.clipGroup){const child=current.children[0];if(child instanceof paper.Group)current=child;else break}return current;}

function isProtected(item){return !!(item?.data?.locked||item?.data?.mockup||item?.data?.isMask||item?.clipMask)}
function isHole(item){return !!item?.data?.isHoleController||item?.data?.geometricRole==='hole'||item?.fillColor===null}
function isCompound(item){if(!item)return false;if(item.data?.geometricHierarchy==='compound')return true;if(item instanceof paper.Group)return item.children?.some(c=>!c.data?.isSelectionBox&&!c.data?.isHandle&&!c.data?.isMask&&!c.data?.mockup);if(item instanceof paper.CompoundPath)return item.children?.length>1;return false;}
function area(item){try{return Math.abs(item.area||item.bounds?.area||0)}catch(_){return item?.bounds?.area||0}}
function centerContained(parent,child){try{return !!parent&&!!child&&parent.contains(child.bounds.center)}catch(_){return false}}
function classifyChildren(item){const children=(item.children||[]).filter(c=>!isProtected(c));return children.sort((a,b)=>area(b)-area(a));}

/**
 * Desagrupa UN SOLO NIVEL. Nunca recorre recursivamente toda la jerarquia.
 * El orden de salida es exterior -> interior y mayor -> menor.
 */
export function ungroupSelectedItem(){
  let item=window.selectedItem;
  if(!item&&window.selectedItems?.length===1)item=window.selectedItems[0];
  if(!item)return;
  if(item.data?.clipGroup)item=getContentItem(item)||item;
  if(isProtected(item)){alert('Este elemento está protegido y no puede desagruparse.');return;}
  if(!isCompound(item)){window.updateContextualMenu?.(item);return;}
  if(typeof window.saveHistory==='function')window.saveHistory();

  const parent=item.parent||paper.project.activeLayer;
  const index=parent.children.indexOf(item);
  const originalMatrix=item.matrix.clone();
  let children=classifyChildren(item);

  // CompoundPath: separar solamente sus contornos directos. Los niveles internos permanecen dentro de cada contorno.
  if(item instanceof paper.CompoundPath){
    if(children.length<=1){window.updateContextualMenu?.(item);return;}
    const result=[];
    children.forEach(child=>{
      child.remove();
      child.matrix=originalMatrix.clone().chain(child.matrix);
      if(child.fillColor===null)child.data={...(child.data||{}),geometricRole:'hole'};
      result.push(child);
    });
    item.remove();
    result.forEach((child,i)=>parent.insertChild(index+i,child));
    window.deselectItem();
    result.forEach(child=>child.selected=true);
    window.selectedItems=[...result];
    window.selectedItem=result[0]||null;
    window.updateSelectionBox?.(window.selectedItem);
    window.updateContextualMenu?.(window.selectedItem);
    paper.view.update();
    return;
  }

  // Group: un solo nivel, preservando cada hijo y su jerarquia interna.
  if(item instanceof paper.Group){
    if(children.length<=1){window.updateContextualMenu?.(item);return;}
    const result=[];
    children.forEach(child=>{
      child.remove();
      child.matrix=originalMatrix.clone().chain(child.matrix);
      result.push(child);
    });
    item.remove();
    result.sort((a,b)=>area(b)-area(a));
    result.forEach((child,i)=>parent.insertChild(index+i,child));
    window.deselectItem();
    result.forEach(child=>child.selected=true);
    window.selectedItems=[...result];
    window.selectedItem=result[0]||null;
    window.updateSelectionBox?.(window.selectedItem);
    window.updateContextualMenu?.(window.selectedItem);
    paper.view.update();
    return;
  }
}

function syncOuterHoleState(outer,hole){if(!outer||!hole)return;outer.data=outer.data||{};hole.data=hole.data||{};outer.data.isOuterWithHoles=true;outer.data.holeIds=Array.from(new Set([...(outer.data.holeIds||[]),hole.id]));hole.data.isHoleController=true;hole.data.outerItemId=outer.id;window.ekkoOuters.set(outer.id,outer);window.ekkoHolesMap.set(hole.id,{outerId:outer.id,hole});}
function clearOuterHoleState(item){if(!item?.data)return;const outerId=item.data.outerItemId;if(outerId){const outer=paper.project.getItem({id:outerId});if(outer?.data?.holeIds)outer.data.holeIds=outer.data.holeIds.filter(id=>id!==item.id);if(outer?.data?.holeIds?.length===0){delete outer.data.isOuterWithHoles;delete outer.data.holeIds;window.ekkoOuters.delete(outer.id)}}window.ekkoHolesMap.delete(item.id);}

function selectResult(result){window.deselectItem?.();const valid=result.filter(Boolean);valid.forEach(item=>item.selected=true);window.selectedItems=valid;window.selectedItem=valid[0]||null;window.updateSelectionBox?.(window.selectedItem);window.updateContextualMenu?.(window.selectedItem);paper.view.update();}

function normalizeGroupData(group){if(!group)return;group.data=group.data||{};group.data.geometricHierarchy='compound';group.data.locked=!!group.data.locked;}

// -------------------------------------------------------------------------
// Utilidades restantes del menu contextual. Se conservan sin cambiar la
// sincronizacion con selection.js y nodeEditor.js.
// -------------------------------------------------------------------------

export function enterSelectedNodeEdit(){
  const item=window.selectedItem;
  if(!item)return;
  if(typeof enterNodeEditMode==='function')enterNodeEditMode(item);
}
export function exitSelectedNodeEdit(){if(typeof exitNodeEditMode==='function')exitNodeEditMode();}

export function canUngroupSelectedItem(){const item=window.selectedItem;return !!item&&!isProtected(item)&&isCompound(item);}

// Mantener disponibles las funciones esperadas por otros módulos.
window.ekkoUngroupAPI={ungroupSelectedItem,groupSelectedItems,canUngroupSelectedItem};
window.ekkoNodeEditAPI={enterSelectedNodeEdit,exitSelectedNodeEdit};

removeOverlapTab();
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{populateFontDropdowns();makeToolbarDraggable()});
  else {populateFontDropdowns();makeToolbarDraggable();}
}
