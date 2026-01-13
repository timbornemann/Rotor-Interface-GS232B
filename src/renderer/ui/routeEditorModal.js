/**
 * RouteEditorModal - Modal for creating and editing routes
 * 
 * Features:
 * - Add/edit route name and description
 * - Add position, wait, and loop steps
 * - Drag & drop to reorder steps
 * - Edit/delete individual steps
 * - Nest steps within loops
 */

class RouteEditorModal {
  constructor() {
    this.modal = null;
    this.route = null; // Route being edited (null for new)
    this.steps = []; // Working copy of steps
    this.onSaveCallback = null;
    this.draggedElement = null;
    this.draggedStep = null;
    this.editingStepData = {}; // Temporary data for step being edited
    
    this.init();
  }

  init() {
    // Modal will be created dynamically when needed
  }

  /**
   * Open the editor modal
   * @param {object|null} route - Route to edit, or null for new route
   * @param {function} onSave - Callback when route is saved
   */
  open(route, onSave) {
    this.route = route;
    this.steps = route ? JSON.parse(JSON.stringify(route.steps || [])) : [];
    this.onSaveCallback = onSave;
    
    this.createModal();
    this.show();
  }

  /**
   * Create the modal DOM
   */
  createModal() {
    // Remove existing modal if any
    const existing = document.getElementById('routeEditorModal');
    if (existing) {
      existing.remove();
    }

    const modalHTML = `
      <div id="routeEditorModal" class="modal route-editor-modal">
        <div class="modal-content route-editor-content">
          <div class="modal-header">
            <h2>${this.route ? 'Route bearbeiten' : 'Neue Route erstellen'}</h2>
            <button class="modal-close" id="closeRouteEditorBtn" type="button">×</button>
          </div>
          
          <div class="modal-body route-editor-body">
            <div class="route-editor-form">
              <div class="form-group">
                <label for="routeName">Name *</label>
                <input type="text" id="routeName" placeholder="z.B. Morgenscan" 
                       value="${this.route ? this.escapeHtml(this.route.name) : ''}" maxlength="50" />
              </div>
              
              <div class="form-group">
                <label for="routeDescription">Beschreibung (optional)</label>
                <textarea id="routeDescription" placeholder="Optionale Beschreibung..." rows="2">${this.route && this.route.description ? this.escapeHtml(this.route.description) : ''}</textarea>
              </div>
            </div>
            
            <div class="step-builder-section">
              <div class="section-header">
                <h3>Schritte</h3>
                <div class="step-add-buttons">
                  <button class="btn-secondary btn-sm" id="addPositionBtn" title="Position hinzufügen">
                    📍 Position
                  </button>
                  <button class="btn-secondary btn-sm" id="addWaitBtn" title="Warte-Schritt hinzufügen">
                    ⏱️ Warten
                  </button>
                  <button class="btn-secondary btn-sm" id="addLoopBtn" title="Loop hinzufügen">
                    🔁 Loop
                  </button>
                </div>
              </div>
              
              <div class="steps-list-editor" id="stepsListEditor">
                ${this.renderStepsForEditor()}
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn-secondary" id="cancelRouteEditorBtn" type="button">Abbrechen</button>
            <button class="btn-primary" id="saveRouteBtn" type="button">Speichern</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('routeEditorModal');
    
    this.bindModalEvents();
  }

  /**
   * Render steps for editor
   */
  renderStepsForEditor(steps = null, level = 0, parentPath = []) {
    const stepsToRender = steps || this.steps;
    
    if (stepsToRender.length === 0) {
      if (level === 0) {
        return `<div class="steps-empty">Keine Schritte - verwenden Sie die Buttons oben zum Hinzufügen</div>`;
      } else {
        return `<div class="steps-empty nested">Keine verschachtelten Schritte</div>`;
      }
    }

    return `
      <div class="editor-steps-container" style="margin-left: ${level * 20}px">
        ${stepsToRender.map((step, index) => {
          const stepPath = [...parentPath, index];
          return this.renderStepForEditor(step, index, level, stepPath);
        }).join('')}
      </div>
    `;
  }

  /**
   * Render a single step for editing
   */
  renderStepForEditor(step, index, level, stepPath) {
    const isExpanded = step.isExpanded || false;
    const pathStr = this.pathToString(stepPath);
    
    if (isExpanded) {
      return this.renderExpandedStepCard(step, index, level, stepPath, pathStr);
    } else {
      return this.renderCollapsedStepCard(step, index, level, stepPath, pathStr);
    }
  }

  /**
   * Render collapsed step card
   */
  renderCollapsedStepCard(step, index, level, stepPath, pathStr) {
    const icons = {
      position: '📍',
      wait: '⏱️',
      loop: '🔁'
    };

    const icon = icons[step.type] || '❓';

    let stepSummary = '';
    switch (step.type) {
      case 'position':
        stepSummary = `${step.name || 'Unbenannt'} (${step.azimuth}°, ${step.elevation}°)`;
        break;
      case 'wait':
        if (step.duration) {
          stepSummary = `${step.duration / 1000}s${step.message ? ': ' + step.message : ''}`;
        } else {
          stepSummary = `Manuell${step.message ? ': ' + step.message : ''}`;
        }
        break;
      case 'loop':
        const iter = step.iterations === Infinity ? '∞' : step.iterations;
        stepSummary = `${iter}x (${(step.steps || []).length} Schritte)`;
        break;
    }

    let html = `
      <div class="editor-step-card ${step.type} collapsed" data-step-path="${pathStr}" data-level="${level}" draggable="true">
        <div class="editor-step-drag">⋮⋮</div>
        <div class="editor-step-icon">${icon}</div>
        <div class="editor-step-info">${stepSummary}</div>
        <div class="editor-step-actions">
          <button class="editor-step-expand-btn" data-step-path="${pathStr}" title="Expandieren">▼</button>
          <button class="editor-step-delete-btn" data-step-path="${pathStr}" title="Löschen">🗑️</button>
        </div>
      </div>
    `;

    // Render nested steps for loops (even when collapsed, show them indented)
    if (step.type === 'loop' && step.steps && step.steps.length > 0) {
      html += `<div class="loop-nested-steps">`;
      html += this.renderStepsForEditor(step.steps, level + 1, stepPath);
      html += `</div>`;
    }

    return html;
  }

  /**
   * Render expanded step card with form
   */
  renderExpandedStepCard(step, index, level, stepPath, pathStr) {
    const icons = {
      position: '📍',
      wait: '⏱️',
      loop: '🔁'
    };
    const labels = {
      position: 'Position',
      wait: 'Warten',
      loop: 'Loop'
    };

    const icon = icons[step.type] || '❓';
    const label = labels[step.type] || 'Unbekannt';

    let formContent = '';
    
    switch (step.type) {
      case 'position':
        formContent = `
          <div class="form-group">
            <label>Name *</label>
            <input type="text" class="step-input" data-field="name" value="${this.escapeHtml(step.name || '')}" placeholder="z.B. Nord" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Azimut (°) *</label>
              <input type="number" class="step-input" data-field="azimuth" value="${step.azimuth || 0}" step="0.1" />
            </div>
            <div class="form-group">
              <label>Elevation (°) *</label>
              <input type="number" class="step-input" data-field="elevation" value="${step.elevation || 0}" step="0.1" min="0" max="90" />
            </div>
          </div>
        `;
        break;
      
      case 'wait':
        const waitType = (step.duration !== null && step.duration !== undefined) ? 'timed' : 'manual';
        formContent = `
          <div class="form-group">
            <label>Typ *</label>
            <select class="step-input" data-field="waitType">
              <option value="timed" ${waitType === 'timed' ? 'selected' : ''}>Zeit-basiert</option>
              <option value="manual" ${waitType === 'manual' ? 'selected' : ''}>Manuell</option>
            </select>
          </div>
          <div class="form-group wait-duration-group" style="${waitType === 'manual' ? 'display:none;' : ''}">
            <label>Dauer (Sekunden) *</label>
            <input type="number" class="step-input" data-field="duration" value="${step.duration ? step.duration / 1000 : 10}" step="0.1" min="0.1" />
          </div>
          <div class="form-group">
            <label>Nachricht (optional)</label>
            <input type="text" class="step-input" data-field="message" value="${this.escapeHtml(step.message || '')}" placeholder="Optional..." />
          </div>
        `;
        break;
      
      case 'loop':
        const iterValue = step.iterations === Infinity ? '' : step.iterations;
        formContent = `
          <div class="form-group">
            <label>Wiederholungen (leer = ∞) *</label>
            <input type="number" class="step-input" data-field="iterations" value="${iterValue}" placeholder="∞" min="1" step="1" />
          </div>
          <div class="loop-nested-section">
            <div class="loop-nested-header">
              <span>Verschachtelte Schritte</span>
            </div>
            <div class="loop-nested-add-buttons">
              <button class="btn-secondary btn-sm add-nested-position-btn" data-container-path="${pathStr}" type="button">📍 Position</button>
              <button class="btn-secondary btn-sm add-nested-wait-btn" data-container-path="${pathStr}" type="button">⏱️ Warten</button>
              <button class="btn-secondary btn-sm add-nested-loop-btn" data-container-path="${pathStr}" type="button">🔁 Loop</button>
            </div>
            <div class="loop-nested-steps">
              ${this.renderStepsForEditor(step.steps || [], level + 1, stepPath)}
            </div>
          </div>
        `;
        break;
    }

    return `
      <div class="editor-step-card ${step.type} expanded" data-step-path="${pathStr}" data-level="${level}">
        <div class="editor-step-header">
          <div class="editor-step-drag">⋮⋮</div>
          <div class="editor-step-icon">${icon}</div>
          <div class="editor-step-label">${label}</div>
          <button class="editor-step-collapse-btn" data-step-path="${pathStr}" title="Zuklappen">▲</button>
        </div>
        <div class="editor-step-form" data-step-path="${pathStr}">
          ${formContent}
          <div class="form-actions">
            <button class="btn-secondary editor-step-cancel-btn" data-step-path="${pathStr}" type="button">Abbrechen</button>
            <button class="btn-primary editor-step-save-btn" data-step-path="${pathStr}" type="button">Speichern</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Bind modal events
   */
  bindModalEvents() {
    const closeBtn = this.modal.querySelector('#closeRouteEditorBtn');
    const cancelBtn = this.modal.querySelector('#cancelRouteEditorBtn');
    const saveBtn = this.modal.querySelector('#saveRouteBtn');
    const addPositionBtn = this.modal.querySelector('#addPositionBtn');
    const addWaitBtn = this.modal.querySelector('#addWaitBtn');
    const addLoopBtn = this.modal.querySelector('#addLoopBtn');
    const stepsListEditor = this.modal.querySelector('#stepsListEditor');

    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.close());
    if (saveBtn) saveBtn.addEventListener('click', () => this.handleSave());
    
    if (addPositionBtn) addPositionBtn.addEventListener('click', () => this.handleAddPosition());
    if (addWaitBtn) addWaitBtn.addEventListener('click', () => this.handleAddWait());
    if (addLoopBtn) addLoopBtn.addEventListener('click', () => this.handleAddLoop());

    if (stepsListEditor) {
      stepsListEditor.addEventListener('click', (e) => {
        // Expand button
        const expandBtn = e.target.closest('.editor-step-expand-btn');
        if (expandBtn) {
          const pathStr = expandBtn.dataset.stepPath;
          this.handleExpandStep(this.stringToPath(pathStr));
          return;
        }

        // Collapse button
        const collapseBtn = e.target.closest('.editor-step-collapse-btn');
        if (collapseBtn) {
          const pathStr = collapseBtn.dataset.stepPath;
          this.handleCollapseStep(this.stringToPath(pathStr), false);
          return;
        }

        // Save button
        const saveBtn = e.target.closest('.editor-step-save-btn');
        if (saveBtn) {
          const pathStr = saveBtn.dataset.stepPath;
          this.handleSaveStep(this.stringToPath(pathStr));
          return;
        }

        // Cancel button
        const cancelBtn = e.target.closest('.editor-step-cancel-btn');
        if (cancelBtn) {
          const pathStr = cancelBtn.dataset.stepPath;
          this.handleCancelStep(this.stringToPath(pathStr));
          return;
        }

        // Delete button
        const deleteBtn = e.target.closest('.editor-step-delete-btn');
        if (deleteBtn) {
          const pathStr = deleteBtn.dataset.stepPath;
          this.handleDeleteStep(this.stringToPath(pathStr));
          return;
        }

        // Add nested steps to loop
        const addNestedPos = e.target.closest('.add-nested-position-btn');
        if (addNestedPos) {
          const containerPath = this.stringToPath(addNestedPos.dataset.containerPath);
          this.handleAddStepToLoop(containerPath, 'position');
          return;
        }

        const addNestedWait = e.target.closest('.add-nested-wait-btn');
        if (addNestedWait) {
          const containerPath = this.stringToPath(addNestedWait.dataset.containerPath);
          this.handleAddStepToLoop(containerPath, 'wait');
          return;
        }

        const addNestedLoop = e.target.closest('.add-nested-loop-btn');
        if (addNestedLoop) {
          const containerPath = this.stringToPath(addNestedLoop.dataset.containerPath);
          this.handleAddStepToLoop(containerPath, 'loop');
          return;
        }
      });

      // Handle wait type change
      stepsListEditor.addEventListener('change', (e) => {
        if (e.target.classList.contains('step-input') && e.target.dataset.field === 'waitType') {
          const form = e.target.closest('.editor-step-form');
          const durationGroup = form.querySelector('.wait-duration-group');
          if (durationGroup) {
            durationGroup.style.display = e.target.value === 'manual' ? 'none' : 'block';
          }
        }
      });

      // Setup drag and drop
      this.setupDragAndDrop(stepsListEditor);
    }

    // Close on backdrop click
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });
  }

  /**
   * Setup drag and drop for reordering steps
   * Now works for nested steps within loops
   */
  setupDragAndDrop(container) {
    const stepCards = container.querySelectorAll('.editor-step-card.collapsed');

    stepCards.forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        this.draggedElement = card;
        const pathStr = card.dataset.stepPath;
        this.draggedPath = this.stringToPath(pathStr);
        this.draggedStep = this.getStepByPath(this.draggedPath);
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        this.draggedElement = null;
        this.draggedPath = null;
        this.draggedStep = null;
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
      });

      card.addEventListener('dragenter', (e) => {
        if (e.target.classList.contains('editor-step-card')) {
          e.target.classList.add('drag-over');
        }
      });

      card.addEventListener('dragleave', (e) => {
        if (e.target.classList.contains('editor-step-card')) {
          e.target.classList.remove('drag-over');
        }
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (!this.draggedStep || !this.draggedPath) return;

        const targetPathStr = card.dataset.stepPath;
        const targetPath = this.stringToPath(targetPathStr);

        // Check if source and target are in same container (same parent)
        const sourceParent = this.draggedPath.slice(0, -1);
        const targetParent = targetPath.slice(0, -1);
        
        if (sourceParent.length !== targetParent.length) return; // Different levels
        
        let sameParent = true;
        for (let i = 0; i < sourceParent.length; i++) {
          if (sourceParent[i] !== targetParent[i]) {
            sameParent = false;
            break;
          }
        }
        
        if (!sameParent) return; // Different parents

        const sourceIndex = this.draggedPath[this.draggedPath.length - 1];
        const targetIndex = targetPath[targetPath.length - 1];

        if (sourceIndex !== targetIndex) {
          // Get the container array
          let containerArray;
          if (sourceParent.length === 0) {
            containerArray = this.steps;
          } else {
            const parentStep = this.getStepByPath(sourceParent);
            if (parentStep && parentStep.type === 'loop') {
              containerArray = parentStep.steps;
            } else {
              return; // Invalid parent
            }
          }

          // Reorder within container
          const [removed] = containerArray.splice(sourceIndex, 1);
          containerArray.splice(targetIndex, 0, removed);
          this.refreshStepsList();
        }
      });
    });
  }

  /**
   * Handle adding position step (creates empty expanded step)
   */
  async handleAddPosition() {
    const step = {
      type: 'position',
      id: this.generateStepId(),
      name: '',
      azimuth: 0,
      elevation: 0,
      isExpanded: true
    };

    this.steps.push(step);
    this.refreshStepsList();
  }

  /**
   * Handle adding wait step (creates empty expanded step)
   */
  async handleAddWait() {
    const step = {
      type: 'wait',
      id: this.generateStepId(),
      duration: 10000, // Default 10 seconds
      message: '',
      isExpanded: true
    };

    this.steps.push(step);
    this.refreshStepsList();
  }

  /**
   * Handle adding loop step (creates empty expanded step)
   */
  async handleAddLoop() {
    const step = {
      type: 'loop',
      id: this.generateStepId(),
      iterations: 3, // Default 3 iterations
      steps: [],
      isExpanded: true
    };

    this.steps.push(step);
    this.refreshStepsList();
  }

  /**
   * Handle adding step to loop
   */
  handleAddStepToLoop(containerPath, stepType) {
    let step;
    
    switch (stepType) {
      case 'position':
        step = {
          type: 'position',
          id: this.generateStepId(),
          name: '',
          azimuth: 0,
          elevation: 0,
          isExpanded: true
        };
        break;
      
      case 'wait':
        step = {
          type: 'wait',
          id: this.generateStepId(),
          duration: 10000,
          message: '',
          isExpanded: true
        };
        break;
      
      case 'loop':
        step = {
          type: 'loop',
          id: this.generateStepId(),
          iterations: 3,
          steps: [],
          isExpanded: true
        };
        break;
    }

    if (step) {
      this.addStepToContainer(containerPath, step);
      this.refreshStepsList();
    }
  }

  /**
   * Handle expand step
   */
  handleExpandStep(path) {
    const step = this.getStepByPath(path);
    if (step) {
      step.isExpanded = true;
      this.refreshStepsList();
    }
  }

  /**
   * Handle collapse step
   */
  handleCollapseStep(path, save = false) {
    const step = this.getStepByPath(path);
    if (step) {
      step.isExpanded = false;
      this.refreshStepsList();
    }
  }

  /**
   * Handle cancel step editing
   */
  handleCancelStep(path) {
    const step = this.getStepByPath(path);
    if (!step) return;

    // If step has no name/data, it's a new empty step - delete it
    if (step.type === 'position' && !step.name) {
      this.handleDeleteStep(path);
    } else {
      step.isExpanded = false;
      this.refreshStepsList();
    }
  }

  /**
   * Handle save step
   */
  handleSaveStep(path) {
    const step = this.getStepByPath(path);
    if (!step) return;

    const pathStr = this.pathToString(path);
    const form = this.modal.querySelector(`.editor-step-form[data-step-path="${pathStr}"]`);
    if (!form) return;

    // Collect form data
    const inputs = form.querySelectorAll('.step-input');
    inputs.forEach(input => {
      const field = input.dataset.field;
      let value = input.value;

      switch (field) {
        case 'name':
        case 'message':
          step[field] = value.trim();
          break;
        
        case 'azimuth':
        case 'elevation':
          step[field] = parseFloat(value) || 0;
          break;
        
        case 'duration':
          step[field] = parseFloat(value) * 1000; // Convert to ms
          break;
        
        case 'iterations':
          step[field] = value === '' ? Infinity : parseInt(value) || 1;
          break;
        
        case 'waitType':
          if (value === 'manual') {
            step.duration = null;
          } else if (!step.duration) {
            step.duration = 10000; // Default
          }
          break;
      }
    });

    // Validate
    const validation = this.validateStep(step);
    if (!validation.valid) {
      alert(validation.error);
      return;
    }

    // Close the form
    step.isExpanded = false;
    this.refreshStepsList();
  }

  /**
   * Handle deleting a step (accepts path for nested steps)
   */
  async handleDeleteStep(path) {
    const step = this.getStepByPath(path);
    if (!step) return;

    const confirmed = confirm(`Schritt "${this.getStepSummary(step)}" wirklich löschen?`);
    if (confirmed) {
      this.deleteStepByPath(path);
      this.refreshStepsList();
    }
  }

  /**
   * Get step summary for display
   */
  getStepSummary(step) {
    switch (step.type) {
      case 'position':
        return step.name || 'Position';
      case 'wait':
        return step.duration ? `Warten ${step.duration / 1000}s` : 'Manuell warten';
      case 'loop':
        return `Loop ${step.iterations === Infinity ? '∞' : step.iterations}x`;
      default:
        return 'Unbekannt';
    }
  }

  /**
   * Refresh the steps list in the editor
   */
  refreshStepsList() {
    const container = this.modal.querySelector('#stepsListEditor');
    if (container) {
      container.innerHTML = this.renderStepsForEditor();
      this.setupDragAndDrop(container);
    }
  }

  /**
   * Handle save
   */
  async handleSave() {
    const nameInput = this.modal.querySelector('#routeName');
    const descInput = this.modal.querySelector('#routeDescription');

    const name = nameInput?.value.trim();
    if (!name) {
      await window.alertModal.showAlert('Bitte geben Sie einen Namen für die Route ein.');
      nameInput?.focus();
      return;
    }

    // Clean steps (remove UI state like isExpanded)
    const cleanedSteps = this.cleanStepsForSave(this.steps);

    const route = {
      id: this.route ? this.route.id : this.generateRouteId(),
      name: name,
      description: descInput?.value.trim() || undefined,
      steps: cleanedSteps,
      order: this.route ? this.route.order : 0,
      createdAt: this.route ? this.route.createdAt : new Date().toISOString()
    };

    if (this.onSaveCallback) {
      this.onSaveCallback(route, !!this.route);
    }

    this.close();
  }

  /**
   * Clean steps for saving (remove UI state)
   */
  cleanStepsForSave(steps) {
    return steps.map(step => {
      const cleaned = { ...step };
      delete cleaned.isExpanded; // Remove UI state
      
      // Recursively clean nested steps
      if (step.type === 'loop' && step.steps) {
        cleaned.steps = this.cleanStepsForSave(step.steps);
      }
      
      return cleaned;
    });
  }

  /**
   * Show modal
   */
  show() {
    if (this.modal) {
      this.modal.classList.remove('hidden');
      const nameInput = this.modal.querySelector('#routeName');
      if (nameInput) {
        setTimeout(() => nameInput.focus(), 100);
      }
    }
  }

  /**
   * Close modal
   */
  close() {
    if (this.modal) {
      this.modal.classList.add('hidden');
      setTimeout(() => {
        this.modal.remove();
        this.modal = null;
      }, 300);
    }
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Generate IDs
   */
  generateRouteId() {
    return `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateStepId() {
    return `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Step path-based data manipulation helpers
   */
  
  // Get step at given path
  getStepByPath(path) {
    if (path.length === 0) return null;
    let current = this.steps;
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]] || !current[path[i]].steps) return null;
      current = current[path[i]].steps;
    }
    return current[path[path.length - 1]];
  }

  // Set step at given path
  setStepByPath(path, step) {
    if (path.length === 0) return;
    let current = this.steps;
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]].steps) current[path[i]].steps = [];
      current = current[path[i]].steps;
    }
    current[path[path.length - 1]] = step;
  }

  // Delete step at given path
  deleteStepByPath(path) {
    if (path.length === 0) return;
    let current = this.steps;
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]] || !current[path[i]].steps) return;
      current = current[path[i]].steps;
    }
    current.splice(path[path.length - 1], 1);
  }

  // Get container array for given path
  getContainerByPath(path) {
    if (path.length === 0) return this.steps;
    let current = this.steps;
    for (let i = 0; i < path.length; i++) {
      if (!current[path[i]]) return null;
      if (i === path.length - 1) {
        // Last element - return its steps array if it's a loop
        if (current[path[i]].type === 'loop') {
          if (!current[path[i]].steps) current[path[i]].steps = [];
          return current[path[i]].steps;
        }
        return null;
      }
      if (!current[path[i]].steps) return null;
      current = current[path[i]].steps;
    }
    return current;
  }

  // Add step to container (top-level or in loop)
  addStepToContainer(containerPath, step) {
    if (containerPath.length === 0) {
      // Top-level
      this.steps.push(step);
    } else {
      // In loop
      const container = this.getContainerByPath(containerPath);
      if (container) {
        container.push(step);
      }
    }
  }

  // Validate step data
  validateStep(step) {
    switch (step.type) {
      case 'position':
        if (!step.name || step.name.trim() === '') {
          return { valid: false, error: 'Position-Name darf nicht leer sein.' };
        }
        if (isNaN(step.azimuth)) {
          return { valid: false, error: 'Azimut muss eine Zahl sein.' };
        }
        if (isNaN(step.elevation)) {
          return { valid: false, error: 'Elevation muss eine Zahl sein.' };
        }
        break;
      
      case 'wait':
        if (step.duration !== null && step.duration !== undefined) {
          if (isNaN(step.duration) || step.duration <= 0) {
            return { valid: false, error: 'Wartezeit muss eine positive Zahl sein.' };
          }
        }
        break;
      
      case 'loop':
        if (step.iterations !== Infinity) {
          if (isNaN(step.iterations) || step.iterations < 1) {
            return { valid: false, error: 'Wiederholungen müssen eine Zahl >= 1 sein oder leer für unendlich.' };
          }
        }
        break;
    }
    return { valid: true };
  }

  // Convert path array to string for data attributes
  pathToString(path) {
    return path.join('-');
  }

  // Convert path string back to array
  stringToPath(pathStr) {
    return pathStr === '' ? [] : pathStr.split('-').map(i => parseInt(i));
  }
}
