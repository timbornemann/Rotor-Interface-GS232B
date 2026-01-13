/**
 * PositionManager - Manages saved rotor positions
 * 
 * Allows users to:
 * - Save current position
 * - Add manual positions
 * - Navigate to saved positions
 * - Reorder positions via drag & drop
 * - Delete positions
 */

class PositionManager {
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.positions = [];
    this.draggedElement = null;
    this.draggedIndex = null;
    
    this.render();
  }

  /**
   * Update positions from config and re-render
   */
  setPositions(positions) {
    this.positions = Array.isArray(positions) ? [...positions] : [];
    // Sort by order property
    this.positions.sort((a, b) => (a.order || 0) - (b.order || 0));
    this.render();
  }

  /**
   * Enable/disable controls based on connection state
   */
  setEnabled(enabled) {
    const buttons = this.root.querySelectorAll('button');
    const inputs = this.root.querySelectorAll('input');
    buttons.forEach(btn => btn.disabled = !enabled);
    inputs.forEach(input => input.disabled = !enabled);
  }

  /**
   * Render the position manager UI
   */
  render() {
    this.root.innerHTML = `
      <div class="positions-manager">
        <div class="positions-header">
          <h3>Gespeicherte Positionen</h3>
          <div class="positions-actions">
            <button class="icon-btn" id="saveCurrentBtn" title="Aktuelle Position speichern">
              <img src="./assets/icons/plus.png" alt="Speichern" class="icon">
            </button>
            <button class="icon-btn" id="addManualBtn" title="Position manuell hinzufügen">
              <img src="./assets/icons/keyboard.png" alt="Manuell" class="icon">
            </button>
          </div>
        </div>
        
        <div class="positions-list" id="positionsList">
          ${this.positions.length === 0 ? this.renderEmptyState() : this.renderPositions()}
        </div>
        
        <div class="position-form hidden" id="positionForm">
          <div class="form-header">
            <h4 id="formTitle">Position hinzufügen</h4>
            <button class="modal-close" id="closeFormBtn" type="button">×</button>
          </div>
          <div class="form-group">
            <label for="positionName">Name</label>
            <input type="text" id="positionName" placeholder="z.B. Norden" maxlength="50" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="positionAz">Azimut (°)</label>
              <input type="number" id="positionAz" min="0" max="450" step="1" value="0" />
            </div>
            <div class="form-group">
              <label for="positionEl">Elevation (°)</label>
              <input type="number" id="positionEl" min="0" max="90" step="1" value="0" />
            </div>
          </div>
          <div class="form-actions">
            <button class="btn-secondary" id="cancelFormBtn">Abbrechen</button>
            <button class="btn-primary" id="saveFormBtn">Speichern</button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  /**
   * Render empty state when no positions are saved
   */
  renderEmptyState() {
    return `
      <div class="positions-empty">
        <img src="./assets/icons/satellite-dish.png" alt="Keine Positionen" class="empty-icon">
        <p>Keine Positionen gespeichert</p>
        <p class="empty-hint">Klicken Sie auf <img src="./assets/icons/plus.png" class="inline-icon"> um die aktuelle Position zu speichern</p>
      </div>
    `;
  }

  /**
   * Render list of saved positions
   */
  renderPositions() {
    return this.positions.map((pos, index) => `
      <div class="position-card" draggable="true" data-index="${index}" data-id="${pos.id}">
        <div class="position-drag-handle">
          <span class="drag-icon">⋮⋮</span>
        </div>
        <div class="position-edit-delete-group">
          <button class="position-edit-btn" data-index="${index}" title="Position bearbeiten">
            <span class="edit-icon">✏️</span>
          </button>
          <button class="position-delete-btn" data-index="${index}" title="Position löschen">
            <img src="./assets/icons/trash.png" alt="Löschen" class="icon">
          </button>
        </div>
        <div class="position-info">
          <div class="position-name">${this.escapeHtml(pos.name)}</div>
          <div class="position-coords">Az: ${pos.azimuth}° / El: ${pos.elevation}°</div>
        </div>
        <button class="position-play-btn" data-index="${index}" title="Position anfahren">
          <img src="./assets/icons/play.png" alt="Anfahren" class="icon">
        </button>
      </div>
    `).join('');
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
    const saveCurrentBtn = this.root.querySelector('#saveCurrentBtn');
    const addManualBtn = this.root.querySelector('#addManualBtn');
    const positionsList = this.root.querySelector('#positionsList');

    if (saveCurrentBtn) {
      saveCurrentBtn.addEventListener('click', () => this.handleSaveCurrent());
    }

    if (addManualBtn) {
      addManualBtn.addEventListener('click', () => this.handleAddManual());
    }

    if (positionsList) {
      // Event delegation for all buttons
      positionsList.addEventListener('click', (e) => {
        const playBtn = e.target.closest('.position-play-btn');
        if (playBtn) {
          const index = parseInt(playBtn.dataset.index, 10);
          this.handlePlayPosition(index);
          return;
        }

        const deleteBtn = e.target.closest('.position-delete-btn');
        if (deleteBtn) {
          const index = parseInt(deleteBtn.dataset.index, 10);
          this.handleDeletePosition(index);
          return;
        }

        const editBtn = e.target.closest('.position-edit-btn');
        if (editBtn) {
          const index = parseInt(editBtn.dataset.index, 10);
          this.handleEditPosition(index);
          return;
        }
      });

      // Drag and drop
      this.setupDragAndDrop(positionsList);
    }

    // Form events
    this.bindFormEvents();
  }

  /**
   * Bind form events
   */
  bindFormEvents() {
    const form = this.root.querySelector('#positionForm');
    const closeBtn = this.root.querySelector('#closeFormBtn');
    const cancelBtn = this.root.querySelector('#cancelFormBtn');
    const saveBtn = this.root.querySelector('#saveFormBtn');
    const nameInput = this.root.querySelector('#positionName');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hideForm());
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.hideForm());
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.handleFormSave());
    }

    if (nameInput) {
      nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.handleFormSave();
        }
      });
    }
  }

  /**
   * Setup drag and drop for position cards
   */
  setupDragAndDrop(container) {
    const cards = container.querySelectorAll('.position-card');

    cards.forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        this.draggedElement = card;
        this.draggedIndex = parseInt(card.dataset.index, 10);
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', card.innerHTML);
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        this.draggedElement = null;
        this.draggedIndex = null;
        // Remove all drag-over classes
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const afterElement = this.getDragAfterElement(container, e.clientY);
        const dragging = container.querySelector('.dragging');

        if (afterElement == null) {
          container.appendChild(dragging);
        } else {
          container.insertBefore(dragging, afterElement);
        }
      });

      card.addEventListener('dragenter', (e) => {
        if (e.target.classList.contains('position-card')) {
          e.target.classList.add('drag-over');
        }
      });

      card.addEventListener('dragleave', (e) => {
        if (e.target.classList.contains('position-card')) {
          e.target.classList.remove('drag-over');
        }
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (this.draggedIndex === null) return;

        const targetIndex = parseInt(card.dataset.index, 10);

        if (this.draggedIndex !== targetIndex) {
          this.handleReorder(this.draggedIndex, targetIndex);
        }
      });
    });
  }

  /**
   * Get the element that should come after the dragged element
   */
  getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.position-card:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;

      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  /**
   * Handle saving current position
   */
  handleSaveCurrent() {
    if (this.callbacks.getCurrentPosition) {
      const currentPos = this.callbacks.getCurrentPosition();
      if (currentPos) {
        this.showForm('Aktuelle Position speichern', currentPos.azimuth, currentPos.elevation, null);
      }
    }
  }

  /**
   * Handle adding manual position
   */
  handleAddManual() {
    this.showForm('Position manuell hinzufügen', 0, 0, null);
  }

  /**
   * Handle editing a position
   */
  handleEditPosition(index) {
    const position = this.positions[index];
    if (position) {
      this.showForm('Position bearbeiten', position.azimuth, position.elevation, position);
    }
  }

  /**
   * Show the add/edit form
   * @param {string} title - Form title
   * @param {number} azimuth - Initial azimuth value
   * @param {number} elevation - Initial elevation value
   * @param {object|null} existingPosition - Existing position to edit (null for new)
   */
  showForm(title, azimuth, elevation, existingPosition) {
    const form = this.root.querySelector('#positionForm');
    const formTitle = this.root.querySelector('#formTitle');
    const nameInput = this.root.querySelector('#positionName');
    const azInput = this.root.querySelector('#positionAz');
    const elInput = this.root.querySelector('#positionEl');

    // Store the position being edited
    this.editingPosition = existingPosition;

    if (formTitle) formTitle.textContent = title;
    if (nameInput) nameInput.value = existingPosition ? existingPosition.name : '';
    if (azInput) azInput.value = Math.round(azimuth);
    if (elInput) elInput.value = Math.round(elevation);

    if (form) {
      form.classList.remove('hidden');
      if (nameInput) nameInput.focus();
    }
  }

  /**
   * Hide the add/edit form
   */
  hideForm() {
    const form = this.root.querySelector('#positionForm');
    if (form) {
      form.classList.add('hidden');
    }
    this.editingPosition = null;
  }

  /**
   * Handle form save
   */
  async handleFormSave() {
    const nameInput = this.root.querySelector('#positionName');
    const azInput = this.root.querySelector('#positionAz');
    const elInput = this.root.querySelector('#positionEl');

    const name = nameInput?.value.trim();
    const azimuth = parseFloat(azInput?.value);
    const elevation = parseFloat(elInput?.value);

    if (!name) {
      await window.alertModal.showAlert('Bitte geben Sie einen Namen ein.');
      nameInput?.focus();
      return;
    }

    if (!Number.isFinite(azimuth) || !Number.isFinite(elevation)) {
      await window.alertModal.showAlert('Bitte geben Sie gültige Koordinaten ein.');
      return;
    }

    if (this.editingPosition) {
      // Edit existing position
      const updatedPosition = {
        ...this.editingPosition,
        name: name,
        azimuth: Math.round(azimuth),
        elevation: Math.round(elevation)
      };

      if (this.callbacks.onEditPosition) {
        this.callbacks.onEditPosition(updatedPosition);
      }
    } else {
      // Create new position
      const newPosition = {
        id: this.generateId(),
        name: name,
        azimuth: Math.round(azimuth),
        elevation: Math.round(elevation),
        order: this.positions.length,
        createdAt: new Date().toISOString()
      };

      if (this.callbacks.onAddPosition) {
        this.callbacks.onAddPosition(newPosition);
      }
    }

    this.editingPosition = null;
    this.hideForm();
  }

  /**
   * Handle playing a position (navigate to it)
   */
  handlePlayPosition(index) {
    const position = this.positions[index];
    if (position && this.callbacks.onPlayPosition) {
      this.callbacks.onPlayPosition(position);
    }
  }

  /**
   * Handle deleting a position
   */
  async handleDeletePosition(index) {
    const position = this.positions[index];
    if (position) {
      // Use the global alertModal for consistency with the rest of the app
      const confirmed = await window.alertModal.showConfirm(
        `Position "${position.name}" wirklich löschen?\n\nAzimut: ${position.azimuth}°\nElevation: ${position.elevation}°`
      );
      if (confirmed && this.callbacks.onDeletePosition) {
        this.callbacks.onDeletePosition(position.id);
      }
    }
  }

  /**
   * Handle reordering positions
   */
  handleReorder(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;

    const newPositions = [...this.positions];
    const [movedItem] = newPositions.splice(fromIndex, 1);
    newPositions.splice(toIndex, 0, movedItem);

    // Update order property
    newPositions.forEach((pos, idx) => {
      pos.order = idx;
    });

    if (this.callbacks.onReorder) {
      this.callbacks.onReorder(newPositions);
    }
  }

  /**
   * Generate unique ID for positions
   */
  generateId() {
    return `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
