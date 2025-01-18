import { promises as fs } from 'fs';
import { join } from 'path';

class DebugLogger {
  private logPath: string;
  private logDir: string;

  constructor() {
    this.logDir = join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'logs');
    this.logPath = join(this.logDir, 'github-server-debug.log');
  }

  async log(message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;
    
    try {
      // Ensure logs directory exists
      await fs.mkdir(this.logDir, { recursive: true });
      
      // Write to log file and also console.error for immediate feedback
      await fs.appendFile(this.logPath, logMessage);
      console.error(logMessage);
    } catch (error) {
      console.error('Failed to write to debug log:', error);
      console.error('Log path:', this.logPath);
      console.error('Error details:', error);
    }
  }
}

export const debugLogger = new DebugLogger();