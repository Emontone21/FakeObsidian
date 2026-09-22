export type ErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_INPUT'
  | 'FOLDER_NOT_FOUND'
  | 'SECTION_NOT_FOUND';

/** Error de dominio: los tools MCP y la API lo traducen a un mensaje util. */
export class BitacoraError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'BitacoraError';
  }
}

export function notFound(message: string): BitacoraError {
  return new BitacoraError('NOT_FOUND', message);
}

export function invalidInput(message: string): BitacoraError {
  return new BitacoraError('INVALID_INPUT', message);
}
