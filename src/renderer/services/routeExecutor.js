/**
 * RouteExecutor - Executes routes with position, wait, and loop steps
 * 
 * Handles:
 * - Sequential execution of route steps
 * - Position steps (move to Az/El and wait for arrival)
 * - Wait steps (time-based or manual)
 * - Loop steps (container with iterations)
 * - Progress tracking and events
 */

class RouteExecutor {
  constructor(rotorService) {
    this.rotorService = rotorService;
    this.currentRoute = null;
    this.isExecuting = false;
    this.shouldStop = false;
    this.currentStepIndex = 0;
    this.currentLoopIteration = 0;
    this.progressListeners = new Set();
    this.completeListeners = new Set();
    this.stopListeners = new Set();
    this.manualContinueResolve = null;
    this.manualWaitCheckInterval = null;
    
    // Position arrival detection
    this.positionTolerance = 2; // degrees
    this.positionTimeout = 60000; // 60 seconds max wait
  }

  /**
   * Execute a route
   * @param {object} route - Route object with steps array
   */
  async executeRoute(route) {
    if (this.isExecuting) {
      throw new Error('Another route is already executing');
    }

    const routeSteps = Array.isArray(route?.steps) ? route.steps : [];
    this.currentRoute = route;
    this.isExecuting = true;
    this.shouldStop = false;
    this.currentStepIndex = 0;

    console.log('[RouteExecutor] Starting route:', route.name);
    this.emitProgress({
      type: 'route_started',
      route: route,
      stepIndex: 0,
      totalSteps: this.countTotalSteps(routeSteps)
    });

    try {
      await this.executeSteps(routeSteps, { routeLevel: true });

      if (!this.shouldStop) {
        console.log('[RouteExecutor] Route completed successfully');
        this.emitComplete({ success: true, route: route });
      } else {
        console.log('[RouteExecutor] Route stopped by user');
        this.emitStop();
      }
    } catch (error) {
      console.error('[RouteExecutor] Route execution error:', error);
      this.emitComplete({ success: false, route: route, error: error.message });
    } finally {
      this.isExecuting = false;
      this.currentRoute = null;
      this.currentStepIndex = 0;
      this.shouldStop = false;
    }
  }

  /**
   * Execute a sequence of steps
   */
  async executeSteps(steps, context = {}) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    for (let i = 0; i < safeSteps.length; i++) {
      if (this.shouldStop) {
        console.log('[RouteExecutor] Execution stopped by user');
        this.emitStop();
        return;
      }

      const step = safeSteps[i];
      if (context.routeLevel) {
        this.currentStepIndex = i;
      }

      await this.executeStep(step, context);
    }
  }

  /**
   * Execute a single step based on type
   */
  async executeStep(step, context = {}) {
    console.log('[RouteExecutor] Executing step:', step.type, step);

    this.emitProgress({
      type: 'step_started',
      step: step,
      stepIndex: this.currentStepIndex,
      loopIteration: context.loopIteration,
      loopTotal: context.loopTotal
    });

    try {
      switch (step.type) {
        case 'position':
          await this.executePositionStep(step);
          break;
        case 'wait':
          await this.executeWaitStep(step);
          break;
        case 'loop':
          await this.executeLoopStep(step);
          break;
        default:
          console.warn('[RouteExecutor] Unknown step type:', step.type);
      }

      this.emitProgress({
        type: 'step_completed',
        step: step,
        stepIndex: this.currentStepIndex
      });
    } catch (error) {
      console.error('[RouteExecutor] Step execution error:', error);
      throw error;
    }
  }

  /**
   * Execute a position step - move to Az/El and wait for arrival
   */
  async executePositionStep(step) {
    console.log(`[RouteExecutor] Moving to position: ${step.name || 'Unnamed'} (Az: ${step.azimuth}°, El: ${step.elevation}°)`);

    this.emitProgress({
      type: 'position_moving',
      step: step,
      target: { azimuth: step.azimuth, elevation: step.elevation }
    });

    // Send movement command
    try {
      await this.rotorService.setAzElRaw({ 
        az: step.azimuth, 
        el: step.elevation 
      });
    } catch (error) {
      console.error('[RouteExecutor] Failed to send position command:', error);
      throw error;
    }

    // Wait for rotor to reach position
    await this.waitForArrival(step.azimuth, step.elevation);

    console.log('[RouteExecutor] Position reached');
    this.emitProgress({
      type: 'position_reached',
      step: step
    });
  }

  /**
   * Wait for rotor to reach target position
   */
  async waitForArrival(targetAz, targetEl) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let lastStatus = null;

      const checkPosition = () => {
        if (this.shouldStop) {
          resolve(); // Exit gracefully if stopped
          return;
        }

        const status = this.rotorService.currentStatus;
        if (!status) {
          // No status yet, keep waiting
          setTimeout(checkPosition, 200);
          return;
        }

        lastStatus = status;

        // Check if position is within tolerance
        const azDiff = Math.abs(status.azimuthRaw - targetAz);
        const elDiff = Math.abs(status.elevationRaw - targetEl);

        if (azDiff <= this.positionTolerance && elDiff <= this.positionTolerance) {
          console.log('[RouteExecutor] Position reached within tolerance');
          resolve();
          return;
        }

        // Check timeout
        if (Date.now() - startTime > this.positionTimeout) {
          console.warn('[RouteExecutor] Position arrival timeout - continuing anyway');
          resolve(); // Don't fail, just continue
          return;
        }

        // Check again soon
        setTimeout(checkPosition, 200);
      };

      checkPosition();
    });
  }

  /**
   * Execute a wait step - time-based or manual
   */
  async executeWaitStep(step) {
    if (step.duration === null || step.duration === undefined) {
      // Manual wait
      console.log('[RouteExecutor] Waiting for manual continue:', step.message || 'No message');
      this.emitProgress({
        type: 'wait_manual',
        step: step,
        message: step.message
      });

      await this.waitForManualContinue();
      
      // Check if stopped during manual wait
      if (this.shouldStop) {
        console.log('[RouteExecutor] Wait aborted by stop');
        return;
      }
    } else {
      // Time-based wait
      const seconds = step.duration / 1000;
      console.log(`[RouteExecutor] Waiting ${seconds}s:`, step.message || 'No message');

      await this.waitWithProgress(step.duration, step);
      
      // Check if stopped during timed wait
      if (this.shouldStop) {
        console.log('[RouteExecutor] Wait aborted by stop');
        return;
      }
    }
  }

  /**
   * Wait for manual continue signal
   */
  async waitForManualContinue() {
    return new Promise((resolve) => {
      this.manualContinueResolve = resolve;
      
      // Also resolve if stop is called
      const checkStop = setInterval(() => {
        if (this.shouldStop) {
          clearInterval(checkStop);
          if (this.manualContinueResolve === resolve) {
            this.manualContinueResolve = null;
          }
          resolve();
        }
      }, 100);
      
      // Store interval ID for cleanup
      this.manualWaitCheckInterval = checkStop;
    });
  }

  /**
   * Continue from manual wait (called externally)
   */
  continueFromManualWait() {
    if (this.manualContinueResolve) {
      console.log('[RouteExecutor] Manual continue triggered');
      this.manualContinueResolve();
      this.manualContinueResolve = null;
    }
    
    // Clean up check interval
    if (this.manualWaitCheckInterval) {
      clearInterval(this.manualWaitCheckInterval);
      this.manualWaitCheckInterval = null;
    }
  }

  /**
   * Wait with progress updates
   */
  async waitWithProgress(duration, step) {
    const startTime = Date.now();
    const updateInterval = 100; // Update every 100ms

    return new Promise((resolve) => {
      const updateProgress = () => {
        if (this.shouldStop) {
          resolve();
          return;
        }

        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, duration - elapsed);

        this.emitProgress({
          type: 'wait_progress',
          step: step,
          elapsed: elapsed,
          remaining: remaining,
          total: duration
        });

        if (elapsed >= duration) {
          resolve();
        } else {
          setTimeout(updateProgress, updateInterval);
        }
      };

      updateProgress();
    });
  }

  /**
   * Execute a loop step - repeat nested steps N times
   */
  async executeLoopStep(step) {
    // Handle null, 0, or Infinity as infinite loop
    let iterations;
    if (step.iterations === null || step.iterations === 0 || step.iterations === Infinity) {
      iterations = Infinity;
    } else {
      iterations = parseInt(step.iterations) || Infinity;
    }
    console.log(`[RouteExecutor] Starting loop: ${iterations === Infinity ? '∞' : iterations} iterations`);

    let currentIteration = 0;

    while (currentIteration < iterations) {
      if (this.shouldStop) {
        break;
      }

      this.currentLoopIteration = currentIteration + 1;

      this.emitProgress({
        type: 'loop_iteration',
        step: step,
        iteration: currentIteration + 1,
        total: iterations
      });

      // Execute nested steps
      const nestedSteps = Array.isArray(step.steps) ? step.steps : [];
      await this.executeSteps(nestedSteps, {
        loopIteration: currentIteration + 1,
        loopTotal: iterations
      });

      currentIteration++;

      // Safety check for infinite loops
      if (iterations === Infinity && currentIteration > 100000) {
        console.warn('[RouteExecutor] Infinite loop safety limit reached');
        break;
      }
    }

    console.log(`[RouteExecutor] Loop completed: ${currentIteration} iterations`);
  }

  /**
   * Stop execution
   */
  stop() {
    if (!this.isExecuting) {
      return;
    }

    console.log('[RouteExecutor] Stop requested');
    this.shouldStop = true;

    // If waiting for manual continue, resolve it
    if (this.manualContinueResolve) {
      this.manualContinueResolve();
      this.manualContinueResolve = null;
    }
    
    // Clean up check interval
    if (this.manualWaitCheckInterval) {
      clearInterval(this.manualWaitCheckInterval);
      this.manualWaitCheckInterval = null;
    }
  }

  /**
   * Get current execution progress
   */
  getCurrentProgress() {
    if (!this.isExecuting || !this.currentRoute) {
      return null;
    }

    return {
      routeName: this.currentRoute.name,
      stepIndex: this.currentStepIndex,
      totalSteps: this.countTotalSteps(this.currentRoute.steps),
      isExecuting: this.isExecuting
    };
  }

  /**
   * Count total steps in a route (including nested)
   */
  countTotalSteps(steps) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    let count = 0;
    for (const step of safeSteps) {
      count++;
      if (step.type === 'loop' && Array.isArray(step.steps)) {
        count += this.countTotalSteps(step.steps);
      }
    }
    return count;
  }

  /**
   * Event listeners
   */
  onProgress(callback) {
    this.progressListeners.add(callback);
    return () => this.progressListeners.delete(callback);
  }

  onComplete(callback) {
    this.completeListeners.add(callback);
    return () => this.completeListeners.delete(callback);
  }

  onStop(callback) {
    this.stopListeners.add(callback);
    return () => this.stopListeners.delete(callback);
  }

  /**
   * Emit events
   */
  emitProgress(data) {
    this.progressListeners.forEach(callback => callback(data));
  }

  emitComplete(data) {
    this.completeListeners.forEach(callback => callback(data));
  }

  emitStop() {
    this.stopListeners.forEach(callback => callback());
  }
}
