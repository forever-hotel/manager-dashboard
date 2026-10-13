import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource } from 'typeorm';
import { CredentialCipher } from './credential-cipher';
import { CreateStaffDto, STAFF_ROLES } from './create-staff.dto';
import { StaffService } from './staff.service';
import { validateStaffConfig } from './staff-config';
import { SendGridService } from './sendgrid.service';
import { StaffDeliveryWorker } from './staff-delivery.worker';

const key = Buffer.alloc(32, 7).toString('base64');
const profile = {
  name: 'Test Staff',
  vocation: 'Reception',
  email: 'staff@example.com',
  age: 25,
  phone: '+94771234567',
  nic: '200012345678',
  role: 'RECEPTIONIST' as const,
};
const credentials = {
  email: profile.email,
  username: 'staff_test',
  password: 'temporary-test-only',
  role: profile.role,
};
const config = () =>
  new ConfigService({
    STAFF_CREDENTIALS_KEY: key,
    STAFF_EMAIL_ENABLED: 'true',
    SENDGRID_API_KEY: 'test-only',
    SENDGRID_FROM_EMAIL: 'sender@example.com',
  });

describe('DDP-012 validation and encrypted credentials', () => {
  it.each(STAFF_ROLES)(
    'accepts %s and normalizes profile fields',
    async (role) => {
      const dto = plainToInstance(CreateStaffDto, {
        ...profile,
        role,
        email: ' STAFF@EXAMPLE.COM ',
        name: ' Test Staff ',
      });
      expect(await validate(dto)).toEqual([]);
      expect(dto.email).toBe(profile.email);
      expect(dto.name).toBe(profile.name);
    },
  );
  it.each([
    { role: 'MANAGER' },
    { role: 'UNKNOWN' },
    { age: 0 },
    { age: 121 },
    { age: '25' },
    { name: '' },
    { name: '<script>' },
    { vocation: '' },
    { email: 'bad' },
    { phone: 'abc' },
    { nic: 'invalid' },
  ])('rejects invalid profile %j', async (change) => {
    expect(
      (
        await validate(
          plainToInstance(CreateStaffDto, { ...profile, ...change }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('authenticates ciphertext and delivery identity without storing plaintext', () => {
    const cipher = new CredentialCipher(config());
    const encrypted = cipher.encrypt('one', credentials);
    expect(encrypted).not.toContain(credentials.password);
    expect(cipher.decrypt('one', encrypted)).toEqual(credentials);
    expect(cipher.encrypt('one', credentials)).not.toBe(encrypted);
    expect(() => cipher.decrypt('two', encrypted)).toThrow();
    expect(() => cipher.decrypt('one', encrypted.slice(0, -5))).toThrow();
    expect(() =>
      new CredentialCipher(new ConfigService()).encrypt('one', credentials),
    ).toThrow();
  });
  it('validates optional and enabled email configuration without exposing values', () => {
    expect(() => validateStaffConfig({})).not.toThrow();
    expect(() =>
      validateStaffConfig({
        STAFF_EMAIL_ENABLED: 'false',
        STAFF_CREDENTIALS_KEY: key,
      }),
    ).not.toThrow();
    expect(() =>
      validateStaffConfig({
        STAFF_EMAIL_ENABLED: 'true',
        STAFF_CREDENTIALS_KEY: key,
        SENDGRID_API_KEY: 'test',
        SENDGRID_FROM_EMAIL: 'sender@example.com',
      }),
    ).not.toThrow();
    for (const env of [
      { STAFF_EMAIL_ENABLED: 'yes' },
      { STAFF_EMAIL_ENABLED: 'true' },
      { STAFF_CREDENTIALS_KEY: 'bad' },
      { DB_LOGGING: 'true' },
    ])
      expect(() => validateStaffConfig(env)).toThrow('Configuration:');
  });
});

describe('DDP-012 transactional creation', () => {
  it('does not write if credential encryption is unavailable', async () => {
    const transaction = jest.fn();
    const service = new StaffService(
      { transaction } as unknown as DataSource,
      new CredentialCipher(new ConfigService()),
    );
    await expect(service.create(profile)).rejects.toMatchObject({
      status: 503,
    });
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each([{ code: '23505' }, new Error('database offline'), null])(
    'sanitizes alternate storage failures',
    async (error) => {
      const transaction = jest.fn().mockRejectedValue(error);
      const service = new StaffService(
        { transaction } as unknown as DataSource,
        new CredentialCipher(config()),
      );
      await expect(service.create(profile)).rejects.toMatchObject({
        status: error && 'code' in error ? 409 : 503,
      });
    },
  );
  it('stores a cost-12 hash and encrypted delivery, returning only identifiers and state', async () => {
    const query = jest
      .fn<Promise<unknown[]>, [string, unknown[]]>()
      .mockResolvedValue([]);
    const database = {
      transaction: jest.fn(
        async (fn: (manager: { query: typeof query }) => Promise<void>) =>
          fn({ query }),
      ),
    };
    const service = new StaffService(
      database as unknown as DataSource,
      new CredentialCipher(config()),
    );
    const result = await service.create(profile);
    expect(result).toEqual({
      staffId: result.staffId,
      deliveryId: result.deliveryId,
      deliveryStatus: 'pending',
    });
    const staffParams = query.mock.calls[0][1];
    const deliveryParams = query.mock.calls[1][1] as string[];
    const payload = new CredentialCipher(config()).decrypt(
      result.deliveryId,
      deliveryParams[2],
    );
    const { compare, getRounds } = await import('bcryptjs');
    expect(getRounds(staffParams[8] as string)).toBe(12);
    expect(await compare(payload.password, staffParams[8] as string)).toBe(
      true,
    );
    expect(payload.username).toBe(staffParams[7]);
    expect(payload.email).toBe(profile.email);
  });
  it.each([
    ['23505', 409],
    ['08006', 503],
  ])('sanitizes database error %s', async (code, status) => {
    const database = {
      transaction: jest
        .fn()
        .mockRejectedValue({ driverError: { code }, detail: 'private data' }),
    };
    await expect(
      new StaffService(
        database as unknown as DataSource,
        new CredentialCipher(config()),
      ).create(profile),
    ).rejects.toMatchObject({ status });
  });
});

describe('DDP-012 SendGrid delivery', () => {
  afterEach(() => jest.restoreAllMocks());
  it('propagates network failure to the retry worker', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));
    await expect(
      new SendGridService(config()).send(credentials),
    ).rejects.toThrow('timeout');
  });
  it('sends via SendGrid and accepts only HTTP 202', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));
    await new SendGridService(config()).send(credentials);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.sendgrid.com/v3/mail/send',
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
      personalizations: unknown;
      content: { value: string }[];
    };
    expect(body.personalizations).toEqual([
      { to: [{ email: credentials.email }] },
    ]);
    expect(body.content[0].value).toContain(credentials.username);
  });
  it.each([400, 401, 429, 500])(
    'rejects provider status %s safely',
    async (status) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('private provider data', { status }));
      await expect(
        new SendGridService(config()).send(credentials),
      ).rejects.toThrow('Email provider did not accept');
    },
  );
});

describe('DDP-012 retry worker', () => {
  it('returns without sending when nothing is due', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const send = jest.fn();
    const worker = new StaffDeliveryWorker(
      { query } as unknown as DataSource,
      config(),
      new CredentialCipher(config()),
      { send } as unknown as SendGridService,
    );
    await worker.processOnce();
    expect(query).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
  it('prevents overlapping timer ticks and stops at shutdown', async () => {
    jest.useFakeTimers();
    const worker = new StaffDeliveryWorker(
      {} as DataSource,
      config(),
      new CredentialCipher(config()),
      new SendGridService(config()),
    );
    let finish!: () => void;
    const process = jest.spyOn(worker, 'processOnce').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    try {
      worker.onApplicationBootstrap();
      jest.advanceTimersByTime(30000);
      expect(process).toHaveBeenCalledTimes(1);
      finish();
      await worker.onApplicationShutdown();
      jest.advanceTimersByTime(30000);
      expect(process).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
  function setup(
    account = {
      is_active: true,
      password_change_required: true,
      session_version: 0,
    },
  ) {
    const cipher = new CredentialCipher(config());
    const delivery = {
      delivery_id: 'delivery',
      worker_id: 'staff',
      encrypted_credentials: cipher.encrypt('delivery', credentials),
      attempts: 1,
      credential_version: 0,
    };
    const query = jest
      .fn<Promise<unknown[]>, [string, unknown[]]>()
      .mockResolvedValueOnce([delivery])
      .mockResolvedValueOnce([account])
      .mockResolvedValue([]);
    const send = jest.fn().mockResolvedValue(undefined);
    const worker = new StaffDeliveryWorker(
      { query } as unknown as DataSource,
      config(),
      cipher,
      { send } as unknown as SendGridService,
    );
    return { worker, query, send };
  }
  it('sends existing credentials then clears ciphertext', async () => {
    const { worker, query, send } = setup();
    await worker.processOnce();
    expect(send).toHaveBeenCalledWith(credentials);
    expect(query.mock.calls[2][0]).toContain('encrypted_credentials=NULL');
    expect(query.mock.calls[2][1]).toEqual([
      'delivery',
      expect.any(String),
      'sent',
    ]);
  });
  it('retains credentials and schedules failed delivery without creating an account', async () => {
    const { worker, query, send } = setup();
    send.mockRejectedValue(new Error('sensitive provider error'));
    await worker.processOnce();
    expect(query.mock.calls[2][0]).toContain("status='failed'");
    expect(query.mock.calls[2][1]).toEqual([
      'delivery',
      expect.any(String),
      30,
    ]);
    expect(JSON.stringify(query.mock.calls)).not.toContain(
      'sensitive provider error',
    );
    expect(query.mock.calls.every(([sql]) => !sql.includes('INSERT'))).toBe(
      true,
    );
  });
  it.each([
    { is_active: false, password_change_required: true, session_version: 0 },
    { is_active: true, password_change_required: false, session_version: 0 },
    { is_active: true, password_change_required: true, session_version: 1 },
  ])('discards obsolete credentials %j', async (account) => {
    const { worker, query, send } = setup(account);
    await worker.processOnce();
    expect(send).not.toHaveBeenCalled();
    expect(query.mock.calls[2][1][2]).toBe('cancelled');
  });
  it('does no work while delivery is disabled', async () => {
    const query = jest.fn();
    const worker = new StaffDeliveryWorker(
      { query } as unknown as DataSource,
      new ConfigService(),
      new CredentialCipher(config()),
      new SendGridService(config()),
    );
    worker.onApplicationBootstrap();
    await worker.processOnce();
    await worker.onApplicationShutdown();
    expect(query).not.toHaveBeenCalled();
  });
});
