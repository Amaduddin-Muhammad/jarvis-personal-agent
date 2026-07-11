import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as ws from 'ws';
import { Injectable, OnModuleInit } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@Injectable()
export class JarvisGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server;

  private aiCoreSocket: ws.WebSocket;
  private isAiCoreConnected = false;
  private readonly aiCoreUrl = 'ws://localhost:8000/ws';

  onModuleInit() {
    this.connectToAiCore();
  }

  // Connect NestJS as a client to the FastAPI Python AI Core WebSocket
  private connectToAiCore() {
    console.log(`Connecting to Python AI Core at ${this.aiCoreUrl}...`);
    this.aiCoreSocket = new ws.WebSocket(this.aiCoreUrl);

    this.aiCoreSocket.on('open', () => {
      console.log('Successfully connected to Python AI Core WebSocket.');
      this.isAiCoreConnected = true;
    });

    this.aiCoreSocket.on('message', (data: ws.RawData) => {
      try {
        const payload = JSON.parse(data.toString());
        // Forward all events from Python AI Core directly to the Next.js frontend
        this.server.emit(payload.type || 'message', payload);
      } catch (err) {
        console.error('Failed to parse message from AI Core:', err);
      }
    });

    this.aiCoreSocket.on('close', () => {
      console.log('Connection to Python AI Core closed. Reconnecting in 3s...');
      this.isAiCoreConnected = false;
      setTimeout(() => this.connectToAiCore(), 3000);
    });

    this.aiCoreSocket.on('error', (err) => {
      console.error('AI Core Socket error:', err.message);
    });
  }

  // Handle connection from HUD Frontend
  handleConnection(client: Socket) {
    console.log(`HUD Frontend connected: ${client.id}`);
    client.emit('log', { level: 'OK', message: 'NestJS Gateway: Secure pipeline open.' });
  }

  handleDisconnect(client: Socket) {
    console.log(`HUD Frontend disconnected: ${client.id}`);
  }

  // Receive message from HUD Frontend and proxy to Python AI Core
  @SubscribeMessage('user_message')
  handleUserMessage(
    @MessageBody() data: any,
    @ConnectedSocket() client: Socket,
  ) {
    console.log('Received user_message from frontend:', data);
    
    // Check if the message is a direct file open command to process locally
    const content = data.content || '';
    if (content.startsWith('/open ')) {
      this.handleDirectOpen(content, client);
      return;
    }

    if (this.isAiCoreConnected) {
      this.aiCoreSocket.send(JSON.stringify(data));
    } else {
      client.emit('log', {
        level: 'ERROR',
        message: 'Python AI Core is offline. Retrying connection...',
      });
    }
  }

  // Directly handle local file opening command
  private handleDirectOpen(command: string, client: Socket) {
    const filePath = command.replace('/open ', '').trim();
    console.log(`Executing direct open command for: ${filePath}`);
    
    // Spawn local process safely via child_process
    const { exec } = require('child_process');
    exec(`start "" "${filePath}"`, (err: any) => {
      if (err) {
        client.emit('log', { level: 'ERROR', message: `Failed to open file: ${err.message}` });
      } else {
        client.emit('log', { level: 'OK', message: `Opened: ${filePath.split('\\').pop()}` });
      }
    });
  }

  // Handle confirm response from client and forward to AI Core
  @SubscribeMessage('confirm_response')
  handleConfirmResponse(@MessageBody() data: any) {
    if (this.isAiCoreConnected) {
      this.aiCoreSocket.send(JSON.stringify(data));
    }
  }
}
