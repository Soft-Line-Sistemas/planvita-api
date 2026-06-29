import { resolveAsaasCredentials } from './asaasClient';

describe('resolveAsaasCredentials', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ASAAS_API_KEY;
    delete process.env.ASAAS_TOKEN;
    delete process.env.ASAAS_BASE_URL;
    delete process.env.ASAAS_WEBHOOK_SECRET;
    delete process.env.ASAAS_ENABLED;
    delete process.env.ASAAS_API_KEY_BOSQUE;
    delete process.env.ASAAS_API_KEY_DEVELOPMENT;
    delete process.env.ASAAS_API_KEY_DEVELOPMENT_BOSQUE;
    delete process.env.ASAAS_BASE_URL_DEVELOPMENT;
    delete process.env.ASAAS_WEBHOOK_SECRET_DEVELOPMENT;
    delete process.env.ASAAS_ENABLED_DEVELOPMENT;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('prioriza credenciais development quando NODE_ENV=development', () => {
    process.env.NODE_ENV = 'development';
    process.env.ASAAS_API_KEY = 'prod-key';
    process.env.ASAAS_API_KEY_DEVELOPMENT = 'dev-key';
    process.env.ASAAS_BASE_URL_DEVELOPMENT = 'https://sandbox.asaas.com/api/v3';
    process.env.ASAAS_WEBHOOK_SECRET_DEVELOPMENT = 'dev-secret';

    const credentials = resolveAsaasCredentials('bosque');

    expect(credentials.apiKey).toBe('dev-key');
    expect(credentials.baseUrl).toBe('https://sandbox.asaas.com/api/v3');
    expect(credentials.webhookSecret).toBe('dev-secret');
  });

  it('prioriza credenciais development por tenant quando existirem', () => {
    process.env.NODE_ENV = 'development';
    process.env.ASAAS_API_KEY_DEVELOPMENT = 'dev-key';
    process.env.ASAAS_API_KEY_DEVELOPMENT_BOSQUE = 'dev-tenant-key';

    const credentials = resolveAsaasCredentials('bosque');

    expect(credentials.apiKey).toBe('dev-tenant-key');
  });

  it('mantem fallback legado fora de development', () => {
    process.env.NODE_ENV = 'production';
    process.env.ASAAS_API_KEY = 'prod-key';
    process.env.ASAAS_BASE_URL = 'https://api.asaas.com/v3';
    process.env.ASAAS_WEBHOOK_SECRET = 'prod-secret';

    const credentials = resolveAsaasCredentials('bosque');

    expect(credentials.apiKey).toBe('prod-key');
    expect(credentials.baseUrl).toBe('https://api.asaas.com/v3');
    expect(credentials.webhookSecret).toBe('prod-secret');
  });

  it('respeita flag de disable por ambiente', () => {
    process.env.NODE_ENV = 'development';
    process.env.ASAAS_API_KEY_DEVELOPMENT = 'dev-key';
    process.env.ASAAS_ENABLED_DEVELOPMENT = 'false';

    const credentials = resolveAsaasCredentials('bosque');

    expect(credentials.enabled).toBe(false);
  });
});
