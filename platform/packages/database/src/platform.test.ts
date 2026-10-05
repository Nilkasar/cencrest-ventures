import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaConstructor = vi.fn();
const adapterConstructor = vi.fn();

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation((options: unknown) => {
    prismaConstructor(options);
    return { organizations: { count: vi.fn().mockResolvedValue(7) }, $disconnect: vi.fn() };
  }),
}));

vi.mock('@prisma/adapter-neon', () => ({
  PrismaNeon: vi.fn().mockImplementation((options: unknown) => {
    adapterConstructor(options);
    return { kind: 'neon-adapter' };
  }),
}));

describe('@bebest/database/platform', () => {
  const ORIGINAL_URL = process.env.PLATFORM_DATABASE_URL;
  const ORIGINAL_APP_URL = process.env.DATABASE_URL;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.PLATFORM_DATABASE_URL;
    const { __resetPlatformDbForTesting } = await import('./platform.js');
    __resetPlatformDbForTesting();
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.PLATFORM_DATABASE_URL;
    else process.env.PLATFORM_DATABASE_URL = ORIGINAL_URL;
    if (ORIGINAL_APP_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_APP_URL;
  });

  it('imports without PLATFORM_DATABASE_URL and constructs nothing', async () => {
    const mod = await import('./platform.js');
    expect(mod.platformDb).toBeDefined();
    expect(prismaConstructor).not.toHaveBeenCalled();
  });

  it('throws PlatformDatabaseNotConfiguredError on first use when unset', async () => {
    const { platformDb, getPlatformDb, PlatformDatabaseNotConfiguredError } = await import('./platform.js');
    expect(() => platformDb.organizations).toThrow(PlatformDatabaseNotConfiguredError);
    expect(() => getPlatformDb()).toThrow(PlatformDatabaseNotConfiguredError);
    expect(prismaConstructor).not.toHaveBeenCalled();
  });

  it('constructs once, on PLATFORM_DATABASE_URL, through the driver adapter', async () => {
    process.env.PLATFORM_DATABASE_URL = 'postgresql://bebest_platform@localhost/bebest';
    const { platformDb, getPlatformDb } = await import('./platform.js');

    await expect(platformDb.organizations.count()).resolves.toBe(7);
    expect(getPlatformDb()).toBe(getPlatformDb());
    expect(prismaConstructor).toHaveBeenCalledTimes(1);
    expect(adapterConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: 'postgresql://bebest_platform@localhost/bebest' }),
    );
  });

  it('never reads DATABASE_URL (the request role) as a fallback', async () => {
    process.env.DATABASE_URL = 'postgresql://bebest_app@localhost/bebest';
    const { getPlatformDb, PlatformDatabaseNotConfiguredError } = await import('./platform.js');
    expect(() => getPlatformDb()).toThrow(PlatformDatabaseNotConfiguredError);
  });
});
