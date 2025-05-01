// src/utils/logger.ts
/**
 * Advanced logging utility with configurable levels, formatting, and output options
 * 
 * Features:
 * - Colored console output for different log levels
 * - Context-aware logging with module identification
 * - Timestamp formatting with high precision
 * - Optional file output with log rotation
 * - Production mode with reduced verbosity
 */

import { format } from 'util';
import fs from 'fs';
import path from 'path';

// Log levels with numeric priority
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

// ANSI color codes for terminal output
const Colors = {
  Reset: "\x1b[0m",
  Bright: "\x1b[1m",
  Dim: "\x1b[2m",
  Underscore: "\x1b[4m",
  Blink: "\x1b[5m",
  Reverse: "\x1b[7m",
  Hidden: "\x1b[8m",
  
  FgBlack: "\x1b[30m",
  FgRed: "\x1b[31m",
  FgGreen: "\x1b[32m",
  FgYellow: "\x1b[33m",
  FgBlue: "\x1b[34m",
  FgMagenta: "\x1b[35m",
  FgCyan: "\x1b[36m",
  FgWhite: "\x1b[37m",
  
  BgBlack: "\x1b[40m",
  BgRed: "\x1b[41m",
  BgGreen: "\x1b[42m",
  BgYellow: "\x1b[43m",
  BgBlue: "\x1b[44m",
  BgMagenta: "\x1b[45m",
  BgCyan: "\x1b[46m",
  BgWhite: "\x1b[47m"
};

// Global logger configuration
interface LoggerConfig {
  minLevel: LogLevel;
  useColors: boolean;
  logToFile: boolean;
  logDir: string;
  logFilename: string;
  maxFileSize: number; // in bytes
  maxFiles: number;
}

// Default configuration
const defaultConfig: LoggerConfig = {
  minLevel: process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG,
  useColors: process.stdout.isTTY,
  logToFile: process.env.LOG_TO_FILE === 'true',
  logDir: process.env.LOG_DIR || 'logs',
  logFilename: process.env.LOG_FILENAME || 'application.log',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5
};

/**
 * Logger class with context-aware logging
 */
export class Logger {
  private static config: LoggerConfig = defaultConfig;
  private static logStream: fs.WriteStream | null = null;
  private static currentFileSize: number = 0;
  
  private context: string;
  
  /**
   * Configure global logger settings
   * @param config Configuration options
   */
  public static configure(config: Partial<LoggerConfig>): void {
    Logger.config = { ...Logger.config, ...config };
    
    // Initialize file logging if enabled
    if (Logger.config.logToFile && !Logger.logStream) {
      Logger.initializeFileLogging();
    }
  }
  
  /**
   * Initialize file logging with rotation support
   */
  private static initializeFileLogging(): void {
    try {
      // Ensure log directory exists
      fs.mkdirSync(Logger.config.logDir, { recursive: true });
      
      const logPath = path.join(Logger.config.logDir, Logger.config.logFilename);
      
      // Check if the file exists to determine initial size
      if (fs.existsSync(logPath)) {
        const stats = fs.statSync(logPath);
        Logger.currentFileSize = stats.size;
      } else {
        Logger.currentFileSize = 0;
      }
      
      // Open write stream in append mode
      Logger.logStream = fs.createWriteStream(logPath, { flags: 'a' });
      
      // Handle stream errors
      Logger.logStream.on('error', (error) => {
        console.error('Error writing to log file:', error);
        Logger.logStream = null;
      });
    } catch (error) {
      console.error('Failed to initialize file logging:', error);
    }
  }
  
  /**
   * Rotate log files when they exceed the configured size
   */
  private static rotateLogFile(): void {
    if (!Logger.logStream) return;
    
    try {
      // Close current stream
      Logger.logStream.end();
      
      const logPath = path.join(Logger.config.logDir, Logger.config.logFilename);
      
      // Shift existing log files
      for (let i = Logger.config.maxFiles - 1; i > 0; i--) {
        const oldPath = `${logPath}.${i}`;
        const newPath = `${logPath}.${i + 1}`;
        
        if (fs.existsSync(oldPath)) {
          fs.renameSync(oldPath, newPath);
        }
      }
      
      // Rename current log to .1
      if (fs.existsSync(logPath)) {
        fs.renameSync(logPath, `${logPath}.1`);
      }
      
      // Open new log file
      Logger.logStream = fs.createWriteStream(logPath, { flags: 'a' });
      Logger.currentFileSize = 0;
      
      // Handle stream errors
      Logger.logStream.on('error', (error) => {
        console.error('Error writing to log file:', error);
        Logger.logStream = null;
      });
    } catch (error) {
      console.error('Failed to rotate log file:', error);
      
      // Try to reopen the stream
      try {
        const logPath = path.join(Logger.config.logDir, Logger.config.logFilename);
        Logger.logStream = fs.createWriteStream(logPath, { flags: 'a' });
      } catch {
        Logger.logStream = null;
      }
    }
  }
  
  /**
   * Create a new logger with specified context
   * @param context Module or component name for context
   */
  constructor(context: string) {
    this.context = context;
  }
  
  /**
   * Log a debug message
   * @param message Message text
   * @param ...args Additional arguments for formatting
   */
  public debug(message: string, ...args: any[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }
  
  /**
   * Log an info message
   * @param message Message text
   * @param ...args Additional arguments for formatting
   */
  public info(message: string, ...args: any[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }
  
  /**
   * Log a warning message
   * @param message Message text
   * @param ...args Additional arguments for formatting
   */
  public warn(message: string, ...args: any[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }
  
  /**
   * Log an error message
   * @param message Message text
   * @param ...args Additional arguments for formatting
   */
  public error(message: string, ...args: any[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }
  
  /**
   * Internal logging implementation
   * @param level Log level
   * @param message Message text
   * @param ...args Additional arguments for formatting
   */
  private log(level: LogLevel, message: string, ...args: any[]): void {
    // Skip if below minimum log level
    if (level < Logger.config.minLevel) {
      return;
    }
    
    // Format timestamp with microsecond precision
    const timestamp = new Date().toISOString();
    
    // Format log level text
    let levelText: string;
    let levelColor: string = '';
    
    switch (level) {
      case LogLevel.DEBUG:
        levelText = 'DEBUG';
        levelColor = Colors.FgCyan;
        break;
      case LogLevel.INFO:
        levelText = 'INFO ';
        levelColor = Colors.FgGreen;
        break;
      case LogLevel.WARN:
        levelText = 'WARN ';
        levelColor = Colors.FgYellow;
        break;
      case LogLevel.ERROR:
        levelText = 'ERROR';
        levelColor = Colors.FgRed;
        break;
      default:
        levelText = 'UNKN ';
        break;
    }
    
    // Format message using util.format
    const formattedMessage = args.length > 0 ? format(message, ...args) : message;
    
    // Build the full log line
    let logLine = `[${timestamp}] [${levelText}] [${this.context}] ${formattedMessage}`;
    
    // Console output with colors if enabled
    if (Logger.config.useColors) {
      console.log(
        `[${Colors.FgBlue}${timestamp}${Colors.Reset}] ` +
        `[${levelColor}${levelText}${Colors.Reset}] ` +
        `[${Colors.FgMagenta}${this.context}${Colors.Reset}] ` +
        formattedMessage
      );
    } else {
      console.log(logLine);
    }
    
    // File output if enabled
    if (Logger.config.logToFile && Logger.logStream) {
      // Add newline for file output
      logLine += '\n';
      
      // Write to file
      Logger.logStream.write(logLine);
      
      // Update file size tracking
      Logger.currentFileSize += Buffer.byteLength(logLine);
      
      // Check if rotation is needed
      if (Logger.currentFileSize >= Logger.config.maxFileSize) {
        Logger.rotateLogFile();
      }
    }
  }
}

