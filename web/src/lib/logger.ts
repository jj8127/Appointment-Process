/**
 * Logger utility for FC Onboarding App
 *
 * Provides structured logging with different log levels and environment-aware behavior.
 * In production, only errors and warnings are logged. In development, all logs are shown.
 */

import Constants from 'expo-constants';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
  timestamp: string;
}

class Logger {
  private isDevelopment: boolean;

  constructor() {
    // Check if running in development mode
    // In React Native/Expo: __DEV__ is available
    // In test environment: NODE_ENV is 'test'
    this.isDevelopment =
      (typeof __DEV__ !== 'undefined' && __DEV__) ||
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'test';
  }

  private shouldLog(level: LogLevel): boolean {
    // In production, only log warnings and errors
    if (!this.isDevelopment) {
      return level === LogLevel.WARN || level === LogLevel.ERROR;
    }
    // In development, log everything
    return true;
  }

  private formatMessage(entry: LogEntry): string {
    const { level, message, data, timestamp } = entry;
    let formatted = `[${timestamp}] [${level}] ${message}`;
    if (data !== undefined) {
      formatted += `\n${JSON.stringify(data, null, 2)}`;
    }
    return formatted;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    const formatted = this.formatMessage(entry);

    switch (level) {
      case LogLevel.DEBUG:
        console.log(formatted);
        break;
      case LogLevel.INFO:
        console.info(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
        console.error(formatted);
        break;
    }
  }

  /**
   * Log debug information (development only)
   */
  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Log informational messages (development only)
   */
  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Log warnings (shown in all environments)
   */
  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Log errors (shown in all environments)
   */
  error(message: string, data?: unknown): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * Log errors with stack trace
   */
  errorWithStack(message: string, error: Error, data?: unknown): void {
    const errorData = {
      ...(data && typeof data === 'object' ? data : {}),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    };
    this.log(LogLevel.ERROR, message, errorData);
  }
}

// Export singleton instance
export const logger = new Logger();

// Convenience exports
export const { debug, info, warn, error, errorWithStack } = logger;
