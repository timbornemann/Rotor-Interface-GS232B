/**
 * RouteManager - Manages routes with position, wait, and loop steps
 * 
 * Inline editing: Routes are edited directly in the panel without modals
 * - Click "New Route" creates a draft route in edit mode
 * - Expanding a route enables editing
 * - All step values are edited inline
 * - Drag & drop for reordering
 */

class RouteManager {
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.routes = [];
    this.expandedRoutes = new Set(); // Track which routes are expanded
    this.draftRoute = null; // New route being created (not yet saved)
    this.editingSteps = new Map(); // Track which steps are being edited: stepPath -> stepData
    this.executingRouteId = null; // ID of currently executing route
    this.currentProgress = null; // Execution progress data
    this.openDropdowns = new Set(); // Track open dropdowns
    
    this.render();
  }

  /**
   * Update routes from config and re-render
   */
  setRoutes(routes) {
    this.routes = Array.isArray(routes) ? [...routes] : [];
    // Sort by order property
    this.routes.sort((a, b) => (a.order || 0) - (b.order || 0));
    this.render();
  }

  /**
   * Enable/disable controls based on connection state
   */
  setEnabled(enabled) {
    const buttons = this.root.querySelectorAll('button');
    const inputs = this.root.querySelectorAll('input, textarea, select');
    buttons.forEach(btn => {
      // Never disable stop button - it should always work
      // Never disable expand button, add route button, save/cancel buttons
      if (btn.classList.contains('route-stop-btn') || 
          btn.classList.contains('route-expand-btn') ||
          btn.classList.contains('btn-cancel') ||
          btn.classList.contains('btn-save') ||
          btn.id === 'addRouteBtn') {
        return;
      }
      btn.disabled = !enabled;
    });
    inputs.forEach(input => {
      // Don't disable inputs in draft/editing mode
      if (input.closest('.route-card.editing')) {
        return;
      }
      input.disabled = !enabled;
    });
  }

  /**
   * Update execution progress
   */
  setExecutionProgress(routeId, progress) {
    // Skip updates for wait_progress to avoid constant re-rendering
    if (progress.type === 'wait_progress' && 
        this.executingRouteId === routeId && 
        this.currentProgress?.type === 'wait_progress') {
      // Already showing wait progress, no need to update
      return;
    }
    
    // Only re-render if route ID changed or progress type is significant
    const shouldRender = this.executingRouteId !== routeId || 
                         !this.currentProgress ||
                         this.currentProgress.type !== progress.type;
    
    this.executingRouteId = routeId;
    this.currentProgress = progress;
    
    if (shouldRender) {
      this.render();
    }
  }

  /**
   * Get progress status text
   */
  getProgressStatusText(progress) {
    switch (progress.type) {
      case 'route_started':
        return 'Route gestartet...';
      case 'step_started':
        return `Schritt ${progress.stepIndex + 1}...`;
      case 'position_moving':
        return 'Fahre zu Position...';
      case 'position_reached':
        return 'Position erreicht';
      case 'wait_manual':
        return `Warte auf Fortsetzung${progress.message ? ': ' + progress.message : ''}`;
      case 'wait_progress':
        return `Warten...${progress.step?.message ? ' (' + progress.step.message + ')' : ''}`;
      case 'loop_iteration':
        const iter = progress.iteration;
        const total = progress.total === Infinity ? '∞' : progress.total;
        return `Loop ${iter} von ${total}`;
      default:
        return progress.type;
    }
  }

  /**
   * Clear execution state
   */
  clearExecution() {
    console.log('[RouteManager] Clearing execution state');
    this.executingRouteId = null;
    this.currentProgress = null;
    this.render();
  }

  /**
   * Render the route manager UI
   */
  render() {
    // Save scroll position before re-rendering
    const routesList = this.root.querySelector('#routesList');
    const scrollTop = routesList ? routesList.scrollTop : 0;
    
    this.root.innerHTML = `
      <div class="routes-manager">
        <div class="routes-header">
          <h3>Routen</h3>
          <div class="routes-actions">
            <button class="icon-btn" id="addRouteBtn" title="Neue Route erstellen">
              <img src="./assets/icons/plus.png" alt="Erstellen" class="icon">
            </button>
          </div>
        </div>
        
        <div class="routes-list" id="routesList">
          ${this.draftRoute ? this.renderDraftRoute() : ''}
          ${this.routes.length === 0 && !this.draftRoute ? this.renderEmptyState() : this.renderRoutes()}
        </div>
      </div>
    `;

    this.bindEvents();
    
    // Restore scroll position after re-rendering
    const newRoutesList = this.root.querySelector('#routesList');
    if (newRoutesList && scrollTop > 0) {
      newRoutesList.scrollTop = scrollTop;
    }
  }

  /**
   * Render empty state when no routes are saved
   */
  renderEmptyState() {
    return `
      <div class="routes-empty">
        <img src="./assets/icons/satellite-dish.png" alt="Keine Routen" class="empty-icon">
        <p>Keine Routen vorhanden</p>
        <p class="empty-hint">Klicken Sie auf <img src="./assets/icons/plus.png" class="inline-icon"> um eine neue Route zu erstellen</p>
      </div>
    `;
  }

  /**
   * Render draft route (new route being created)
   */
  renderDraftRoute() {
    return this.renderEditableRoute(this.draftRoute, true);
  }

  /**
   * Render list of routes
   */
  renderRoutes() {
    return this.routes.map((route, index) => {
      const isExpanded = this.expandedRoutes.has(route.id);
      const isExecuting = this.executingRouteId === route.id;

      // When expanded, route is in edit mode
      if (isExpanded && !isExecuting) {
        return this.renderEditableRoute(route, false);
      } else {
        return this.renderCollapsedRoute(route, isExecuting);
      }
    }).join('');
  }

  /**
   * Render collapsed route card
   */
  renderCollapsedRoute(route, isExecuting) {
    const stepCount = this.countSteps(route.steps || []);

    return `
      <div class="route-card ${isExecuting ? 'executing' : ''}" 
           data-route-id="${route.id}">
        <div class="route-header">
          <div class="route-drag-handle">
            <span class="drag-icon">⋮⋮</span>
          </div>
          
          <div class="route-info" data-route-id="${route.id}">
            <div class="route-name">${this.escapeHtml(route.name)}</div>
            <div class="route-meta">${stepCount} ${stepCount === 1 ? 'Schritt' : 'Schritte'}</div>
          </div>
          
          <div class="route-edit-delete-group">
            <button class="route-delete-btn" data-route-id="${route.id}" title="Route löschen">
              <img src="./assets/icons/trash.png" alt="Löschen" class="icon">
            </button>
          </div>
          
          ${isExecuting ? `
            <button class="route-stop-btn" data-route-id="${route.id}" title="Route stoppen">
              <img src="./assets/icons/circle-pause.png" alt="Stoppen" class="icon">
            </button>
          ` : `
            <button class="route-play-btn" data-route-id="${route.id}" title="Route starten">
              <img src="./assets/icons/play.png" alt="Starten" class="icon">
            </button>
          `}
        </div>
        
        ${isExecuting && this.currentProgress ? this.renderProgress() : ''}
        
        <button class="route-expand-btn" data-route-id="${route.id}" title="Aufklappen & Bearbeiten">
          <span class="expand-icon">▼</span>
          <span class="expand-text">Details anzeigen</span>
        </button>
      </div>
    `;
  }

  /**
   * Render editable route card (expanded state)
   */
  renderEditableRoute(route, isDraft) {
    const steps = route.steps || [];

    return `
      <div class="route-card editing expanded" data-route-id="${route.id}">
        <div class="route-edit-header">
          <input type="text" 
                 class="route-name-input" 
                 placeholder="Route Name" 
                 value="${this.escapeHtml(route.name || '')}"
                 data-field="name">
          <textarea class="route-description-input" 
                    placeholder="Beschreibung (optional)" 
                    rows="2"
                    data-field="description">${this.escapeHtml(route.description || '')}</textarea>
        </div>
        
        <div class="route-steps-edit-container">
          ${steps.length === 0 ? `
            <div class="route-steps-empty">
              <p>Keine Schritte - Fügen Sie Schritte hinzu</p>
            </div>
          ` : `
            <div class="route-steps-list">
              ${this.renderEditableSteps(steps, [])}
            </div>
          `}
          
          ${this.renderAddStepDropdown([])}
        </div>
        
        <div class="route-edit-actions">
          <button class="btn-secondary btn-cancel" data-route-id="${route.id}">
            Abbrechen
          </button>
          <button class="btn-primary btn-save" data-route-id="${route.id}">
            ${isDraft ? 'Erstellen' : 'Speichern'}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render editable steps - flattened view with loop start/end blocks
   */
  renderEditableSteps(steps, parentPath) {
    const flatList = this.flattenStepsForDisplay(steps, parentPath);
    return flatList.map(item => this.renderFlatStepItem(item)).join('');
  }

  /**
   * Flatten steps into a linear list with loop start/end markers
   */
  flattenStepsForDisplay(steps, parentPath, depth = 0) {
    const result = [];
    
    steps.forEach((step, index) => {
      const stepPath = [...parentPath, index];
      
      if (step.type === 'loop') {
        // Add loop start
        result.push({
          type: 'loop-start',
          step: step,
          path: stepPath,
          depth: depth
        });
        
        // Add nested steps (indented)
        if (step.steps && step.steps.length > 0) {
          const nestedFlat = this.flattenStepsForDisplay(step.steps, stepPath, depth + 1);
          result.push(...nestedFlat);
        }
        
        // Add "add step in loop" option
        result.push({
          type: 'loop-add',
          path: stepPath,
          depth: depth + 1
        });
        
        // Add loop end
        result.push({
          type: 'loop-end',
          step: step,
          path: stepPath,
          depth: depth
        });
      } else {
        // Regular step (position, wait)
        result.push({
          type: 'step',
          step: step,
          path: stepPath,
          depth: depth
        });
      }
    });
    
    return result;
  }

  /**
   * Render a single item in the flattened list
   */
  renderFlatStepItem(item) {
    const indentStyle = item.depth > 0 ? `style="margin-left: ${item.depth * 24}px;"` : '';
    const pathStr = item.path.join('-');
    
    switch (item.type) {
      case 'loop-start':
        const iterations = item.step.iterations === Infinity ? '∞' : item.step.iterations;
        return `
          <div class="step-card editable loop loop-start" data-step-path="${pathStr}" ${indentStyle}>
            <div class="step-header">
              <img src="./assets/icons/repeat.png" alt="Loop" class="step-icon-img">
              <span class="step-type-label">Loop Start</span>
              <button class="step-delete-btn" data-path="${pathStr}" title="Loop löschen">
                <img src="./assets/icons/trash.png" alt="Löschen" class="icon-small">
              </button>
            </div>
            <div class="step-inline-form">
              <div class="form-group">
                <label>Iterationen (0 = ∞)</label>
                <input type="number" 
                       value="${iterations === '∞' ? 0 : iterations}"
                       min="0"
                       step="1"
                       data-path="${pathStr}"
                       data-field="iterations">
              </div>
            </div>
          </div>
        `;
        
      case 'loop-end':
        return `
          <div class="step-card loop-end" ${indentStyle}>
            <div class="step-header">
              <img src="./assets/icons/repeat.png" alt="Loop" class="step-icon-img">
              <span class="step-type-label">Loop End</span>
            </div>
          </div>
        `;
        
      case 'loop-add':
        return `
          <div class="loop-add-step-container" ${indentStyle}>
            ${this.renderAddStepDropdown(item.path)}
          </div>
        `;
        
      case 'step':
        return this.renderRegularStep(item.step, item.path, item.depth);
        
      default:
        return '';
    }
  }

  /**
   * Render a regular step (position, wait)
   */
  renderRegularStep(step, stepPath, depth) {
    const pathStr = stepPath.join('-');
    const indentStyle = depth > 0 ? `style="margin-left: ${depth * 24}px;"` : '';
    const icons = {
      position: './assets/icons/map-pin.png',
      wait: './assets/icons/timer.png'
    };
    const iconSrc = icons[step.type] || '';

    let formContent = '';
    
    switch (step.type) {
      case 'position':
        formContent = `
          <div class="step-inline-form">
            <div class="form-group">
              <label>Name</label>
              <input type="text" 
                     value="${this.escapeHtml(step.name || '')}"
                     placeholder="Position Name"
                     data-path="${pathStr}"
                     data-field="name">
            </div>
            <div class="form-group">
              <label>Azimut (°)</label>
              <input type="number" 
                     value="${step.azimuth || 0}"
                     min="0"
                     max="450"
                     step="0.1"
                     data-path="${pathStr}"
                     data-field="azimuth">
            </div>
            <div class="form-group">
              <label>Elevation (°)</label>
              <input type="number" 
                     value="${step.elevation || 0}"
                     min="0"
                     max="90"
                     step="0.1"
                     data-path="${pathStr}"
                     data-field="elevation">
            </div>
          </div>
        `;
        break;
        
      case 'wait':
        const isManual = !step.duration;
        formContent = `
          <div class="step-inline-form">
            <div class="form-group">
              <label>Typ</label>
              <select data-path="${pathStr}" data-field="waitType">
                <option value="time" ${!isManual ? 'selected' : ''}>Zeit</option>
                <option value="manual" ${isManual ? 'selected' : ''}>Manuell</option>
              </select>
            </div>
            <div class="form-group ${isManual ? 'hidden' : ''}" data-duration-group>
              <label>Dauer (Sekunden)</label>
              <input type="number" 
                     value="${step.duration ? step.duration / 1000 : 5}"
                     min="1"
                     step="1"
                     data-path="${pathStr}"
                     data-field="duration">
            </div>
            <div class="form-group">
              <label>Nachricht (optional)</label>
              <input type="text" 
                     value="${this.escapeHtml(step.message || '')}"
                     placeholder="z.B. 'Warte auf Signal'"
                     data-path="${pathStr}"
                     data-field="message">
            </div>
          </div>
        `;
        break;
    }

    return `
      <div class="step-card editable ${step.type}" data-step-path="${pathStr}" ${indentStyle}>
        <div class="step-header">
          ${iconSrc ? `<img src="${iconSrc}" alt="${step.type}" class="step-icon-img">` : ''}
          <span class="step-type-label">${this.getStepTypeLabel(step.type)}</span>
          <button class="step-delete-btn" data-path="${pathStr}" title="Schritt löschen">
            <img src="./assets/icons/trash.png" alt="Löschen" class="icon-small">
          </button>
        </div>
        ${formContent}
      </div>
    `;
  }

  /**
   * Render add step dropdown button
   */
  renderAddStepDropdown(parentPath) {
    const pathStr = parentPath.join('-') || 'root';
    const isOpen = this.openDropdowns.has(pathStr);
    
    return `
      <div class="add-step-dropdown ${isOpen ? 'open' : ''}" data-dropdown-path="${pathStr}">
        <button class="btn-secondary add-step-btn" data-dropdown-path="${pathStr}">
          + Schritt hinzufügen
          <span class="dropdown-arrow">▼</span>
        </button>
        ${isOpen ? `
          <div class="add-step-menu">
            <button class="add-step-option" data-type="position" data-parent-path="${pathStr}">
              <img src="./assets/icons/map-pin.png" alt="Position" class="step-icon-img"> Position
            </button>
            <button class="add-step-option" data-type="wait" data-parent-path="${pathStr}">
              <img src="./assets/icons/timer.png" alt="Warten" class="step-icon-img"> Warten
            </button>
            <button class="add-step-option" data-type="loop" data-parent-path="${pathStr}">
              <img src="./assets/icons/repeat.png" alt="Loop" class="step-icon-img"> Loop
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Render execution progress
   */
  renderProgress() {
    if (!this.currentProgress) return '';

    const statusText = this.getProgressStatusText(this.currentProgress);

    return `
      <div class="route-progress">
        <div class="progress-status">${statusText}</div>
        ${this.currentProgress.type === 'wait_manual' ? `
          <button class="btn-primary" id="manualContinueBtn">Fortfahren</button>
        ` : ''}
      </div>
    `;
  }

  /**
   * Count total steps (including nested)
   */
  countSteps(steps) {
    let count = 0;
    for (const step of steps) {
      count++;
      if (step.type === 'loop' && step.steps) {
        count += this.countSteps(step.steps);
      }
    }
    return count;
  }

  /**
   * Get step type label
   */
  getStepTypeLabel(type) {
    const labels = {
      position: 'Position',
      wait: 'Warten',
      loop: 'Loop'
    };
    return labels[type] || type;
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    const addRouteBtn = this.root.querySelector('#addRouteBtn');
    const routesList = this.root.querySelector('#routesList');
    const manualContinueBtn = this.root.querySelector('#manualContinueBtn');

    if (addRouteBtn) {
      addRouteBtn.addEventListener('click', () => this.handleAddNewRoute());
    }

    if (manualContinueBtn) {
      manualContinueBtn.addEventListener('click', () => this.handleManualContinue());
    }

    if (routesList) {
      // Event delegation for all route actions
      routesList.addEventListener('click', (e) => {
        const playBtn = e.target.closest('.route-play-btn');
        if (playBtn) {
          const routeId = playBtn.dataset.routeId;
          this.handlePlayRoute(routeId);
          return;
        }

        const stopBtn = e.target.closest('.route-stop-btn');
        if (stopBtn) {
          this.handleStopRoute();
          return;
        }

        const deleteBtn = e.target.closest('.route-delete-btn');
        if (deleteBtn) {
          const routeId = deleteBtn.dataset.routeId;
          this.handleDeleteRoute(routeId);
          return;
        }

        const expandBtn = e.target.closest('.route-expand-btn');
        if (expandBtn) {
          const routeId = expandBtn.dataset.routeId;
          this.handleToggleExpand(routeId);
          return;
        }

        const saveBtn = e.target.closest('.btn-save');
        if (saveBtn) {
          const routeId = saveBtn.dataset.routeId;
          this.handleSaveRoute(routeId);
          return;
        }

        const cancelBtn = e.target.closest('.btn-cancel');
        if (cancelBtn) {
          const routeId = cancelBtn.dataset.routeId;
          this.handleCancelEdit(routeId);
          return;
        }

        const stepDeleteBtn = e.target.closest('.step-delete-btn');
        if (stepDeleteBtn) {
          const path = stepDeleteBtn.dataset.path;
          this.handleDeleteStep(path);
          return;
        }

        const addStepBtn = e.target.closest('.add-step-btn');
        if (addStepBtn) {
          const dropdownPath = addStepBtn.dataset.dropdownPath;
          this.handleToggleDropdown(dropdownPath);
          return;
        }

        const addStepOption = e.target.closest('.add-step-option');
        if (addStepOption) {
          const type = addStepOption.dataset.type;
          const parentPath = addStepOption.dataset.parentPath;
          this.handleAddStep(type, parentPath);
          return;
        }

        // Click on route info also toggles expand for collapsed routes
        const routeInfo = e.target.closest('.route-info');
        if (routeInfo) {
          const routeId = routeInfo.dataset.routeId;
          const card = routeInfo.closest('.route-card');
          // Only toggle if not in edit mode and not executing
          if (!card.classList.contains('editing') && !card.classList.contains('executing')) {
            this.handleToggleExpand(routeId);
          }
          return;
        }
      });

      // Handle input changes for inline editing
      routesList.addEventListener('input', (e) => {
        if (e.target.matches('.route-name-input, .route-description-input')) {
          // Route-level field changes are handled on save
          return;
        }

        if (e.target.matches('[data-path][data-field]')) {
          const path = e.target.dataset.path;
          const field = e.target.dataset.field;
          this.handleStepFieldChange(path, field, e.target);
        }
      });

      // Handle select changes for wait type
      routesList.addEventListener('change', (e) => {
        if (e.target.matches('[data-field="waitType"]')) {
          const path = e.target.dataset.path;
          const isManual = e.target.value === 'manual';
          
          // Toggle duration field visibility
          const stepCard = e.target.closest('.step-card');
          const durationGroup = stepCard.querySelector('[data-duration-group]');
          if (durationGroup) {
            if (isManual) {
              durationGroup.classList.add('hidden');
            } else {
              durationGroup.classList.remove('hidden');
            }
          }
          
          this.handleStepFieldChange(path, 'waitType', e.target);
        } else if (e.target.matches('[data-path][data-field]')) {
          const path = e.target.dataset.path;
          const field = e.target.dataset.field;
          this.handleStepFieldChange(path, field, e.target);
        }
      });
    }

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.add-step-dropdown')) {
        this.openDropdowns.clear();
        // Only re-render if there were open dropdowns
        if (this.root.querySelector('.add-step-dropdown.open')) {
          this.render();
        }
      }
    });
  }

  /**
   * Handle add new route
   */
  handleAddNewRoute() {
    // Create draft route
    this.draftRoute = {
      id: this.generateId(),
      name: '',
      description: '',
      steps: [],
      order: this.routes.length
    };
    
    // Auto-expand and render
    this.expandedRoutes.add(this.draftRoute.id);
    this.render();
    
    // Focus name input
    setTimeout(() => {
      const nameInput = this.root.querySelector('.route-name-input');
      if (nameInput) nameInput.focus();
    }, 0);
  }

  /**
   * Handle save route
   */
  async handleSaveRoute(routeId) {
    const isDraft = this.draftRoute && this.draftRoute.id === routeId;
    const route = isDraft ? this.draftRoute : this.routes.find(r => r.id === routeId);
    
    if (!route) return;
    
    // Collect form data
    const card = this.root.querySelector(`[data-route-id="${routeId}"]`);
    if (!card) return;
    
    const nameInput = card.querySelector('.route-name-input');
    const descInput = card.querySelector('.route-description-input');
    
    const name = nameInput?.value.trim() || '';
    const description = descInput?.value.trim() || '';
    
    // Validate
    if (!name) {
      await window.alertModal.showAlert('Bitte geben Sie einen Namen für die Route ein.');
      nameInput?.focus();
      return;
    }
    
    // Update route object
    route.name = name;
    route.description = description;
    
    // Save via callback
    if (isDraft) {
      if (this.callbacks.onAddRoute) {
        await this.callbacks.onAddRoute(route);
      }
      this.draftRoute = null;
      this.expandedRoutes.delete(routeId);
    } else {
      if (this.callbacks.onEditRoute) {
        await this.callbacks.onEditRoute(route);
      }
      this.expandedRoutes.delete(routeId);
    }
    
    this.render();
  }

  /**
   * Handle cancel edit
   */
  handleCancelEdit(routeId) {
    const isDraft = this.draftRoute && this.draftRoute.id === routeId;
    
    if (isDraft) {
      this.draftRoute = null;
    } else {
      this.expandedRoutes.delete(routeId);
    }
    
    this.render();
  }

  /**
   * Handle delete route
   */
  async handleDeleteRoute(routeId) {
    const route = this.routes.find(r => r.id === routeId);
    if (route) {
      const stepCount = this.countSteps(route.steps || []);
      const confirmed = await window.alertModal.showConfirm(
        `Route "${route.name}" wirklich löschen?\n\n${stepCount} ${stepCount === 1 ? 'Schritt' : 'Schritte'}`
      );
      if (confirmed && this.callbacks.onDeleteRoute) {
        this.callbacks.onDeleteRoute(routeId);
      }
    }
  }

  /**
   * Handle play/execute route
   */
  handlePlayRoute(routeId) {
    const route = this.routes.find(r => r.id === routeId);
    if (route && this.callbacks.onPlayRoute) {
      this.callbacks.onPlayRoute(route);
    }
  }

  /**
   * Handle stop route execution
   */
  handleStopRoute() {
    console.log('[RouteManager] Stop button clicked');
    if (this.callbacks.onStopRoute) {
      this.callbacks.onStopRoute();
    }
    
    // Immediately clear execution state for responsive UI
    this.clearExecution();
  }

  /**
   * Handle toggle expand/collapse
   */
  handleToggleExpand(routeId) {
    if (this.expandedRoutes.has(routeId)) {
      this.expandedRoutes.delete(routeId);
    } else {
      this.expandedRoutes.add(routeId);
    }
    this.render();
  }

  /**
   * Handle manual continue during wait step
   */
  handleManualContinue() {
    if (this.callbacks.onManualContinue) {
      this.callbacks.onManualContinue();
    }
  }

  /**
   * Handle toggle dropdown
   */
  handleToggleDropdown(dropdownPath) {
    const wasOpen = this.openDropdowns.has(dropdownPath);
    
    if (wasOpen) {
      this.openDropdowns.delete(dropdownPath);
    } else {
      this.openDropdowns.clear(); // Only one dropdown open at a time
      this.openDropdowns.add(dropdownPath);
    }
    
    this.render();
    
    // Scroll to opened dropdown
    if (!wasOpen) {
      setTimeout(() => {
        const dropdownElement = this.root.querySelector(`[data-dropdown-path="${dropdownPath}"]`);
        if (dropdownElement) {
          dropdownElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 50);
    }
  }

  /**
   * Handle add step
   */
  handleAddStep(type, parentPathStr) {
    const route = this.draftRoute || this.routes.find(r => this.expandedRoutes.has(r.id));
    if (!route) return;
    
    // Create new step
    const newStep = this.createStepOfType(type);
    
    // Add to route or parent loop
    const parentPath = parentPathStr === 'root' ? [] : parentPathStr.split('-').map(Number);
    let newStepPath;
    
    if (parentPath.length === 0) {
      // Add to root level
      route.steps.push(newStep);
      newStepPath = [route.steps.length - 1].join('-');
    } else {
      // Add to nested container (loop)
      const parentStep = this.getStepByPath(route, parentPath);
      if (parentStep && parentStep.type === 'loop') {
        if (!parentStep.steps) parentStep.steps = [];
        parentStep.steps.push(newStep);
        newStepPath = [...parentPath, parentStep.steps.length - 1].join('-');
      }
    }
    
    // Close dropdown and re-render
    this.openDropdowns.clear();
    this.render();
    
    // Scroll to newly added step
    if (newStepPath) {
      setTimeout(() => {
        const newStepElement = this.root.querySelector(`[data-step-path="${newStepPath}"]`);
        if (newStepElement) {
          newStepElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 50);
    }
  }

  /**
   * Handle delete step
   */
  handleDeleteStep(pathStr) {
    const route = this.draftRoute || this.routes.find(r => this.expandedRoutes.has(r.id));
    if (!route) return;
    
    const path = pathStr.split('-').map(Number);
    this.deleteStepByPath(route, path);
    
    this.render();
  }

  /**
   * Handle step field change
   */
  handleStepFieldChange(pathStr, field, inputElement) {
    const route = this.draftRoute || this.routes.find(r => this.expandedRoutes.has(r.id));
    if (!route) return;
    
    const path = pathStr.split('-').map(Number);
    const step = this.getStepByPath(route, path);
    if (!step) return;
    
    // Update step based on field
    let value = inputElement.value;
    
    switch (field) {
      case 'name':
      case 'message':
        step[field] = value;
        break;
      case 'azimuth':
      case 'elevation':
        step[field] = parseFloat(value) || 0;
        break;
      case 'duration':
        step.duration = (parseFloat(value) || 0) * 1000; // Convert to ms
        break;
      case 'iterations':
        const iter = parseInt(value) || 0;
        step.iterations = iter === 0 ? Infinity : iter;
        break;
      case 'waitType':
        if (value === 'manual') {
          delete step.duration;
        } else {
          step.duration = 5000; // Default 5s
        }
        break;
    }
  }

  /**
   * Create a new step of given type
   */
  createStepOfType(type) {
    const id = this.generateId();
    
    switch (type) {
      case 'position':
        return {
          id,
          type: 'position',
          name: 'Position',
          azimuth: 0,
          elevation: 0
        };
      case 'wait':
        return {
          id,
          type: 'wait',
          duration: 5000, // 5 seconds default
          message: ''
        };
      case 'loop':
        return {
          id,
          type: 'loop',
          iterations: 1,
          steps: []
        };
      default:
        return null;
    }
  }

  /**
   * Get step by path
   */
  getStepByPath(route, path) {
    let current = route.steps;
    let step = null;
    
    for (let i = 0; i < path.length; i++) {
      const index = path[i];
      if (!current || index >= current.length) return null;
      
      step = current[index];
      
      if (i < path.length - 1) {
        // Need to go deeper
        if (step.type === 'loop') {
          current = step.steps || [];
        } else {
          return null; // Can't go deeper, not a loop
        }
      }
    }
    
    return step;
  }

  /**
   * Delete step by path
   */
  deleteStepByPath(route, path) {
    if (path.length === 0) return;
    
    if (path.length === 1) {
      // Root level
      route.steps.splice(path[0], 1);
    } else {
      // Nested
      const parentPath = path.slice(0, -1);
      const index = path[path.length - 1];
      const parentStep = this.getStepByPath(route, parentPath);
      
      if (parentStep && parentStep.type === 'loop' && parentStep.steps) {
        parentStep.steps.splice(index, 1);
      }
    }
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
