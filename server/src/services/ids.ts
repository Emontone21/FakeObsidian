import { monotonicFactory } from 'ulid';

/**
 * ULID monotonico: dos ids generados en el mismo milisegundo igual quedan
 * ordenados. Asi el id sirve de desempate confiable cuando dos notas comparten
 * el mismo updated_at (que tiene precision de segundos).
 */
export const newId = monotonicFactory();
