import { Injectable } from "@angular/core";
import { io, Socket } from "socket.io-client";

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket = io('http://localhost:3000/mediasoup', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });

  /** The socket ID assigned by the server after connection */
  get socketId(): string | undefined {
    return this.socket.id;
  }

  emit<T = any>(event: string, data?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      this.socket.emit(event, data, (res: any) => {
        if (res?.error) reject(res.error);
        else resolve(res);
      });
    });
  }

  on(event: string, listener: (...args: any[]) => void) {
    this.socket.on(event, listener);
  }

  off(event: string, listener?: (...args: any[]) => void) {
    this.socket.off(event, listener);
  }

  disconnect() {
    console.log('[SocketService] Disconnecting socket:', this.socket.id);
    this.socket.disconnect();
  }

  connect() {
    console.log('[SocketService] Connecting socket');
    this.socket.connect();
  }
}
