import { ExecutionContext } from '@nestjs/common';
import { AuthService } from './auth.service';
import { bearer, AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
describe('Authentication routes and guard', () => {
  const request: { headers: { authorization: string }; user?: unknown } = {
    headers: { authorization: 'Bearer token' },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  it.each([undefined, '', 'Basic x', 'Bearer '])(
    'rejects absent/malformed bearer %s',
    (value) => {
      expect(() => bearer(value)).toThrow();
    },
  );
  it('attaches a centrally verified session and propagates rejection', async () => {
    const session = jest.fn().mockResolvedValue({ username: 'manager' });
    const guard = new JwtAuthGuard({ session } as unknown as AuthService);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ username: 'manager' });
    session.mockRejectedValue(new Error('revoked'));
    await expect(guard.canActivate(context)).rejects.toThrow('revoked');
  });
  it('forwards login, session, logout and password change to the central adapter', async () => {
    const methods = {
      login: jest.fn(),
      session: jest.fn(),
      logout: jest.fn(),
      changePassword: jest.fn(),
    };
    const controller = new AuthController(methods as unknown as AuthService);
    await controller.login({ username: 'manager', password: 'password' });
    await controller.session('Bearer token');
    await controller.logout('Bearer token');
    await controller.changePassword(
      { currentPassword: 'old', newPassword: 'new' },
      'Bearer token',
    );
    expect(methods.session).toHaveBeenCalledWith('token', true);
    expect(methods.login).toHaveBeenCalled();
    expect(methods.logout).toHaveBeenCalledWith('token');
    expect(methods.changePassword).toHaveBeenCalledWith('token', {
      currentPassword: 'old',
      newPassword: 'new',
    });
  });
});
