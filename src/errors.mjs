export class ActionError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    Object.assign(this, extra);
  }
}
