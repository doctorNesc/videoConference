import { Injectable } from "@angular/core";
import { io } from "socket.io-client";

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket = io('http://localhost:3000/mediasoup');

  emit<T = any>(event: string, data?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      console.log('socket.emit ->', event, data);
      this.socket.emit(event, data, (res: any) => {
        console.log('socket res <-', event, res);
        if (res?.error) reject(res.error);
        else resolve(res);
      });
    });
  }

  on(event: string, listener: (...args: any[]) => void) {
    this.socket.on(event, listener);
  }
}
