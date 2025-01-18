import { promises as fs } from 'fs';
import { join } from 'path';

class DebugLogger {
  private logPath: string;

  constructor() {
    this.logPath = join(process.cwd(), 'debug.log');
  }

  async log(message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;
    
    try {
      // Ensure directory exists
      const dir = process.cwd();
      await fs.mkdir(dir, { recursive: true });
      
      // Write to log file and also console.error for immediate feedback
      await fs.appendFile(this.logPath, logMessage);
      console.error(logMessage);
    } catch (error) {
      console.error('Failed to write to debug log:', error);
    }
  }
}

export const debugLogger = new DebugLogger();