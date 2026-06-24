/**
 * Utility functions for validating and sanitizing Pi events
 * Prevents malformed event structures that could cause TypeError when Pi CLI processes them
 */

export interface PiEventValidationResult {
  valid: boolean;
  errors: string[];
  sanitized?: any; // Cleaned event if there were issues
}

/**
 * Detect if a value is a callable function
 */
function isCallable(value: any): boolean {
  return typeof value === 'function';
}

/**
 * Sanitize a message object to remove callable fields that Pi CLI cannot handle
 */
function sanitizeMessage(msg: any): any {
  if (!msg || typeof msg !== 'object') {
    return msg;
  }

  const sanitized = { ...msg };

  // Remove any callable 'result' field - Pi will try to call this as a method
  if (isCallable(sanitized.result)) {
    console.warn(
      '[Pi Event Sanitizer] Warning: Removing callable message.result field that would cause TypeError in Pi CLI'
    );
    delete sanitized.result;
  }

  // Sanitize content array if present
  if (Array.isArray(sanitized.content)) {
    sanitized.content = sanitized.content.map((part: any) => {
      if (part && typeof part === 'object' && isCallable(part.result)) {
        console.warn('[Pi Event Sanitizer] Warning: Removing callable content part result field');
        const cleanPart = { ...part };
        delete cleanPart.result;
        return cleanPart;
      }
      return part;
    });
  }

  return sanitized;
}

/**
 * Sanitize a partial object (used in start events)
 */
function sanitizePartial(partial: any): any {
  if (!partial || typeof partial !== 'object') {
    return partial;
  }

  const sanitized = { ...partial };

  // Remove callable result field
  if (isCallable(sanitized.result)) {
    console.warn(
      '[Pi Event Sanitizer] Warning: Removing callable partial.result field that would cause TypeError in Pi CLI'
    );
    delete sanitized.result;
  }

  // Sanitize content if present
  if (Array.isArray(sanitized.content)) {
    sanitized.content = sanitized.content.map((part: any) => {
      if (part && typeof part === 'object' && isCallable(part.result)) {
        console.warn('[Pi Event Sanitizer] Warning: Removing callable partial content result field');
        const cleanPart = { ...part };
        delete cleanPart.result;
        return cleanPart;
      }
      return part;
    });
  }

  return sanitized;
}

/**
 * Validate Pi event structure
 * Returns validation result with list of errors if invalid
 */
export function validatePiEvent(event: any): PiEventValidationResult {
  const errors: string[] = [];

  // Check event is an object
  if (!event || typeof event !== 'object') {
    errors.push('Event is not an object');
    return { valid: false, errors };
  }

  // Check type field exists
  if (!event.type || typeof event.type !== 'string') {
    errors.push('Event missing or has invalid "type" field');
  }

  // Validate message structure for events that have messages
  if (event.message) {
    if (typeof event.message !== 'object') {
      errors.push('Event message is not an object');
    } else {
      const msg = event.message;

      // Check for problematic callable fields
      if (isCallable(msg.result)) {
        errors.push(
          'Event message.result is a function (callable) - will cause TypeError when Pi tries to use it'
        );
      }

      // Validate role field
      if (msg.role && typeof msg.role !== 'string') {
        errors.push('Event message.role is not a string');
      }

      // Content should be array if present
      if (msg.content && !Array.isArray(msg.content)) {
        errors.push('Event message.content is not an array');
      }

      // Check for callable fields in content parts
      if (Array.isArray(msg.content)) {
        msg.content.forEach((part: any, idx: number) => {
          if (part && typeof part === 'object' && isCallable(part.result)) {
            errors.push(
              `Event message.content[${idx}].result is a function (callable) - will cause TypeError`
            );
          }
        });
      }

      // Usage should be object if present
      if (msg.usage && typeof msg.usage !== 'object') {
        errors.push('Event message.usage is not an object');
      }
    }
  }

  // Validate partial structure for start events
  if (event.partial) {
    if (typeof event.partial !== 'object') {
      errors.push('Event partial is not an object');
    } else {
      const partial = event.partial;

      if (isCallable(partial.result)) {
        errors.push(
          'Event partial.result is a function (callable) - will cause TypeError when Pi tries to use it'
        );
      }

      // Content should be array if present
      if (partial.content && !Array.isArray(partial.content)) {
        errors.push('Event partial.content is not an array');
      }

      // Check for callable fields in content parts
      if (Array.isArray(partial.content)) {
        partial.content.forEach((part: any, idx: number) => {
          if (part && typeof part === 'object' && isCallable(part.result)) {
            errors.push(
              `Event partial.content[${idx}].result is a function (callable) - will cause TypeError`
            );
          }
        });
      }
    }
  }

  const valid = errors.length === 0;

  if (!valid) {
    // Create sanitized version
    let sanitized = { ...event };
    if (event.message) {
      sanitized.message = sanitizeMessage(event.message);
    }
    if (event.partial) {
      sanitized.partial = sanitizePartial(event.partial);
    }
    return { valid, errors, sanitized };
  }

  return { valid, errors };
}

/**
 * Sanitize a Pi event to fix common structural issues
 * Used before emitting events to Pi CLI
 */
export function sanitizePiEvent(event: any): any {
  if (!event || typeof event !== 'object') {
    return event;
  }

  const sanitized = { ...event };

  if (event.message) {
    sanitized.message = sanitizeMessage(event.message);
  }

  if (event.partial) {
    sanitized.partial = sanitizePartial(event.partial);
  }

  if (event.error && typeof event.error === 'object') {
    const errorObj = { ...event.error };
    if (isCallable(errorObj.result)) {
      console.warn('[Pi Event Sanitizer] Warning: Removing callable error.result field');
      delete errorObj.result;
    }
    sanitized.error = errorObj;
  }

  return sanitized;
}
