import { Injectable } from "@angular/core";
import { io } from "socket.io-client";

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket = io('/mediasoup');

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
}
