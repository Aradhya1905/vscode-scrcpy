export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export type LogLevel = 'info' | 'warn' | 'error';
export interface LogEntry {
    id: number;
    message: string;
    level: LogLevel;
    timestamp: Date;
}
export interface DeviceInfo {
    id: string;
    model: string;
    androidVersion: string;
    sdkVersion: number;
    battery: {
        level: number;
        isCharging: boolean;
        temperature?: number;
    };
    network: {
        connected: boolean;
        type?: 'wifi' | 'cellular' | 'ethernet' | 'none';
        signalStrength?: number;
    };
    storage: {
        total: number;
        available: number;
        used: number;
    };
}
export interface DeviceListItem {
    id: string;
    name: string;
    model?: string;
    status: 'device' | 'unauthorized' | 'offline';
}
export interface TouchEventData {
    command: 'touch';
    action: 'down' | 'move' | 'up';
    x: number;
    y: number;
    videoWidth: number;
    videoHeight: number;
}
export interface KeyEventData {
    command: 'key';
    action: 'down' | 'up';
    keyCode: number;
    metaState: number;
}
export interface ScrollEventData {
    command: 'scroll';
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
    videoWidth: number;
    videoHeight: number;
}
export type WebviewMessage =
    | {
          command: 'start';
      }
    | {
          command: 'stop';
      }
    | {
          command: 'ready';
      }
    | {
          command: 'home';
      }
    | {
          command: 'back';
      }
    | {
          command: 'app-switch';
      }
    | {
          command: 'screenshot';
      }
    | {
          command: 'get-device-info';
      }
    | {
          command: 'get-device-list';
      }
    | {
          command: 'select-device';
          deviceId: string;
      }
    | TouchEventData
    | KeyEventData
    | ScrollEventData;
export type ExtensionMessage =
    | {
          type: 'connecting';
      }
    | {
          type: 'connected';
      }
    | {
          type: 'disconnected';
      }
    | {
          type: 'video';
          data: string;
      }
    | {
          type: 'error';
          message: string;
      }
    | {
          type: 'device-info';
          info: DeviceInfo;
      }
    | {
          type: 'device-list';
          devices: DeviceListItem[];
      }
    | {
          type: 'device-selected';
          deviceId: string;
      };
