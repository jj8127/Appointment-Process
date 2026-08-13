import { logger } from '../logger';
import { setSentryCaptureException } from '../sentry-monitor';

describe('Logger', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let sentryCaptureSpy: jest.Mock;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    sentryCaptureSpy = jest.fn();
    setSentryCaptureException(sentryCaptureSpy);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    setSentryCaptureException(null);
  });

  describe('debug', () => {
    it('should log debug messages in development', () => {
      logger.debug('Debug message');
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleLogSpy.mock.calls[0][0]).toContain('[DEBUG]');
      expect(consoleLogSpy.mock.calls[0][0]).toContain('Debug message');
    });

    it('should log debug messages with data', () => {
      const testData = { key: 'value', number: 42 };
      logger.debug('Debug with data', testData);
      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      expect(logOutput).toContain('[DEBUG]');
      expect(logOutput).toContain('Debug with data');
      expect(logOutput).toContain('"key"');
      expect(logOutput).toContain('"value"');
    });
  });

  describe('info', () => {
    it('should log info messages', () => {
      logger.info('Info message');
      expect(consoleInfoSpy).toHaveBeenCalled();
      expect(consoleInfoSpy.mock.calls[0][0]).toContain('[INFO]');
      expect(consoleInfoSpy.mock.calls[0][0]).toContain('Info message');
    });
  });

  describe('warn', () => {
    it('should log warning messages', () => {
      logger.warn('Warning message');
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('[WARN]');
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('Warning message');
    });
  });

  describe('error', () => {
    it('should log error messages', () => {
      logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[ERROR]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('Error message');
    });

    it('sanitizes console and Sentry-adjacent diagnostics while preserving classification', () => {
      const bearerToken = 'eyJhbGciOiJIUzI1NiJ9.payloadpayload.signaturesignature';
      const pushToken = 'ExponentPushToken[device-secret-value]';
      const storagePath = 'fc-documents/user-1/customer-id.pdf';

      logger.error('Delivery failed for +82 10-1234-5678', {
        authorization: `Bearer ${bearerToken}`,
        residentId: '990101-1234567',
        otpCode: '654321',
        expoPushToken: pushToken,
        storagePath,
        upstreamResponseBody: '{"phone":"010-9876-5432"}',
        status: 502,
        reason: 'upstream_rejected',
      });

      const consoleOutput = String(consoleErrorSpy.mock.calls[0][0]);
      const [capturedError, capturedContext] = sentryCaptureSpy.mock.calls[0];
      const capturedOutput = JSON.stringify({
        name: capturedError.name,
        message: capturedError.message,
        stack: capturedError.stack,
        context: capturedContext,
      });

      for (const sensitiveValue of [
        bearerToken,
        '+82 10-1234-5678',
        '990101-1234567',
        '654321',
        pushToken,
        storagePath,
        '010-9876-5432',
      ]) {
        expect(consoleOutput).not.toContain(sensitiveValue);
        expect(capturedOutput).not.toContain(sensitiveValue);
      }
      expect(consoleOutput).toContain('"status": 502');
      expect(consoleOutput).toContain('"reason": "upstream_rejected"');
      expect(capturedOutput).toContain('upstream_rejected');
    });

    it('rebuilds raw Error instances with a sanitized message and stack', () => {
      const rawError = new Error(
        'Bearer device-secret +82 10-1234-5678 OTP: 654321 at fc-documents/user-1/customer-id.pdf',
      );
      rawError.name = 'ProviderDeliveryError';
      rawError.stack = `${rawError.name}: ${rawError.message}\n    at send(fc-documents/user-1/customer-id.pdf)`;

      logger.error('Provider delivery failed', rawError);

      const consoleOutput = String(consoleErrorSpy.mock.calls[0][0]);
      const [capturedError] = sentryCaptureSpy.mock.calls[0];
      const capturedOutput = `${capturedError.name}\n${capturedError.message}\n${capturedError.stack}`;

      for (const sensitiveValue of [
        'device-secret',
        '+82 10-1234-5678',
        '654321',
        'fc-documents/user-1/customer-id.pdf',
      ]) {
        expect(consoleOutput).not.toContain(sensitiveValue);
        expect(capturedOutput).not.toContain(sensitiveValue);
      }
      expect(capturedError.name).toBe('ProviderDeliveryError');
    });
  });

  describe('errorWithStack', () => {
    it('should log error with stack trace', () => {
      const testError = new Error('Test error');
      logger.errorWithStack('Error occurred', testError);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const logOutput = consoleErrorSpy.mock.calls[0][0];
      expect(logOutput).toContain('[ERROR]');
      expect(logOutput).toContain('Error occurred');
      expect(logOutput).toContain('Test error');
      expect(logOutput).toContain('stack');
    });

    it('should log error with additional data', () => {
      const testError = new Error('Test error');
      const additionalData = { userId: '123', action: 'login' };
      logger.errorWithStack('Error occurred', testError, additionalData);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const logOutput = consoleErrorSpy.mock.calls[0][0];
      expect(logOutput).toContain('userId');
      expect(logOutput).toContain('123');
      expect(logOutput).toContain('action');
      expect(logOutput).toContain('login');
    });
  });

  describe('timestamp formatting', () => {
    it('should include ISO timestamp in all log messages', () => {
      logger.debug('Test message');
      const logOutput = consoleLogSpy.mock.calls[0][0];

      // Check for ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)
      expect(logOutput).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });
  });
});
