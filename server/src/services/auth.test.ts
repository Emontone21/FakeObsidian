import { describe, expect, it } from 'vitest';
import { hashPassword, LoginThrottle, verifyPassword } from './auth.js';

describe('hash de contrasena', () => {
  it('verifica la correcta y rechaza la incorrecta', () => {
    const stored = hashPassword('una-contrasena-larga');
    expect(verifyPassword('una-contrasena-larga', stored)).toBe(true);
    expect(verifyPassword('otra-contrasena', stored)).toBe(false);
  });

  it('usa una sal distinta cada vez', () => {
    expect(hashPassword('misma')).not.toBe(hashPassword('misma'));
  });

  it('no explota con un hash guardado con formato raro', () => {
    expect(verifyPassword('x', 'basura')).toBe(false);
    expect(verifyPassword('x', 'md5:abc:def')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
  });
});

describe('LoginThrottle', () => {
  it('deja pasar los primeros intentos y bloquea al llegar al limite', () => {
    const throttle = new LoginThrottle(3, 1000);
    expect(throttle.retryAfterMs('ip')).toBe(0);

    throttle.recordFailure('ip', 0);
    throttle.recordFailure('ip', 10);
    expect(throttle.retryAfterMs('ip', 20)).toBe(0);

    throttle.recordFailure('ip', 20);
    expect(throttle.retryAfterMs('ip', 20)).toBe(1000);
  });

  it('libera cuando vence el bloqueo y vuelve a contar desde cero', () => {
    const throttle = new LoginThrottle(2, 1000);
    throttle.recordFailure('ip', 0);
    throttle.recordFailure('ip', 0);
    expect(throttle.retryAfterMs('ip', 0)).toBe(1000);
    expect(throttle.retryAfterMs('ip', 1001)).toBe(0);

    throttle.recordFailure('ip', 1001);
    expect(throttle.retryAfterMs('ip', 1001)).toBe(0);
  });

  it('no acumula fallos separados por mas que la ventana', () => {
    const throttle = new LoginThrottle(2, 1000, 5000);
    throttle.recordFailure('ip', 0);
    throttle.recordFailure('ip', 6000);
    expect(throttle.retryAfterMs('ip', 6000)).toBe(0);
  });

  it('un login exitoso limpia el contador', () => {
    const throttle = new LoginThrottle(2, 1000);
    throttle.recordFailure('ip', 0);
    throttle.reset('ip');
    throttle.recordFailure('ip', 10);
    expect(throttle.retryAfterMs('ip', 10)).toBe(0);
  });

  it('cuenta por separado cada origen', () => {
    const throttle = new LoginThrottle(2, 1000);
    throttle.recordFailure('a', 0);
    throttle.recordFailure('a', 0);
    expect(throttle.retryAfterMs('a', 0)).toBe(1000);
    expect(throttle.retryAfterMs('b', 0)).toBe(0);
  });
});
