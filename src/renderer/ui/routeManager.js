/**
 * RouteManager - Manages routes with position, wait, and loop steps
 * 
 * Allows users to:
 * - Create/edit/delete routes
 * - View routes (collapsed/expanded)
 * - Execute routes
 * - Manage steps within routes (position, wait, loop)
 */

class RouteManager {
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.routes = [];
    this.expandedRoutes = new Set(); // Track which routes are expanded
    this.editingRoute = null; // Route being edited
    this.executingRouteId = null; // ID of currently executing route
    this.currentProgress = null; // Execution progress data
    
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
    const inputs = this.root.querySelectorAll('input');
    buttons.forEach(btn => {
      // Never disable stop button - it should always work
      // Never disable expand button
      if (btn.classList.contains('route-stop-btn') || 
          btn.classList.contains('route-expand-btn')) {
        return;
      }
      btn.disabled = !enabled;
    });
    inputs.forEach(input => input.disabled = !enabled);
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
          ${this.routes.length === 0 ? this.renderEmptyState() : this.renderRoutes()}
        </div>
      </div>
    `;

    this.bindEvents();
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
   * Render list of routes
   */
  renderRoutes() {
    return this.routes.map((route, index) => {
      const isExpanded = this.expandedRoutes.has(route.id);
      const isExecuting = this.executingRouteId === route.id;
      const stepCount = this.countSteps(route.steps || []);

      return `
        <div class="route-card ${isExpanded ? 'expanded' : ''} ${isExecuting ? 'executing' : ''}" 
             data-route-id="${route.id}">
          <div class="route-header">
            <div class="route-drag-handle">
              <span class="drag-icon">⋮⋮</span>
            </div>
            
            <div class="route-edit-delete-group">
              <button class="route-edit-btn" data-route-id="${route.id}" title="Route bearbeiten">
                <span class="edit-icon">✏️</span>
              </button>
              <button class="route-delete-btn" data-route-id="${route.id}" title="Route löschen">
                <img src="./assets/icons/trash.png" alt="Löschen" class="icon">
              </button>
            </div>
            
            <div class="route-info" data-route-id="${route.id}">
              <div class="route-name">${this.escapeHtml(route.name)}</div>
              <div class="route-meta">${stepCount} ${stepCount === 1 ? 'Schritt' : 'Schritte'}</div>
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
          
          ${isExpanded ? this.renderSteps(route.steps || [], route.id) : ''}
          ${isExecuting && this.currentProgress ? this.renderProgress() : ''}
          
          <button class="route-expand-btn" data-route-id="${route.id}" title="${isExpanded ? 'Zuklappen' : 'Aufklappen'}">
            <span class="expand-icon">${isExpanded ? '▲' : '▼'}</span>
            <span class="expand-text">${isExpanded ? 'Zuklappen' : 'Details anzeigen'}</span>
          </button>
        </div>
      `;
    }).join('');
  }

  /**
   * Render steps within a route
   */
  renderSteps(steps, routeId, level = 0) {
    if (steps.length === 0) {
      return `
        <div class="route-steps-empty" style="margin-left: ${level * 20}px">
          <p>Keine Schritte - Route bearbeiten um Schritte hinzuzufügen</p>
        </div>
      `;
    }

    return `
      <div class="route-steps-list" style="margin-left: ${level * 20}px">
        ${steps.map((step, index) => this.renderStep(step, index, routeId, level)).join('')}
      </div>
    `;
  }

  /**
   * Render a single step
   */
  renderStep(step, index, routeId, level) {
    const icons = {
      position: '📍',
      wait: '⏱️',
      loop: '🔁'
    };

    const icon = icons[step.type] || '❓';
    const isNested = level > 0;

    let stepInfo = '';
    switch (step.type) {
      case 'position':
        stepInfo = `${step.name || 'Position'} (Az: ${step.azimuth}°, El: ${step.elevation}°)`;
        break;
      case 'wait':
        if (step.duration) {
          stepInfo = `Warten ${step.duration / 1000}s${step.message ? ': ' + step.message : ''}`;
        } else {
          stepInfo = `Manuell fortfahren${step.message ? ': ' + step.message : ''}`;
        }
        break;
      case 'loop':
        const iterations = step.iterations === Infinity ? '∞' : step.iterations;
        stepInfo = `Loop ${iterations}x (${(step.steps || []).length} Schritte)`;
        break;
    }

    let content = `
      <div class="step-card ${step.type} ${isNested ? 'nested' : ''}" data-step-id="${step.id}">
        <span class="step-icon">${icon}</span>
        <span class="step-info">${stepInfo}</span>
      </div>
    `;

    // Render nested steps for loops
    if (step.type === 'loop' && step.steps && step.steps.length > 0) {
      content += this.renderSteps(step.steps, routeId, level + 1);
    }

    return content;
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
      addRouteBtn.addEventListener('click', () => this.handleAddRoute());
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

        const editBtn = e.target.closest('.route-edit-btn');
        if (editBtn) {
          const routeId = editBtn.dataset.routeId;
          this.handleEditRoute(routeId);
          return;
        }

        const expandBtn = e.target.closest('.route-expand-btn');
        if (expandBtn) {
          const routeId = expandBtn.dataset.routeId;
          this.handleToggleExpand(routeId);
          return;
        }

        // Click on route info also toggles expand
        const routeInfo = e.target.closest('.route-info');
        if (routeInfo) {
          const routeId = routeInfo.dataset.routeId;
          this.handleToggleExpand(routeId);
          return;
        }
      });
    }
  }

  /**
   * Handle add new route
   */
  handleAddRoute() {
    if (this.callbacks.onAddRoute) {
      this.callbacks.onAddRoute();
    }
  }

  /**
   * Handle edit route
   */
  handleEditRoute(routeId) {
    const route = this.routes.find(r => r.id === routeId);
    if (route && this.callbacks.onEditRoute) {
      this.callbacks.onEditRoute(route);
    }
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
   * Generate unique ID
   */
  generateId() {
    return `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
