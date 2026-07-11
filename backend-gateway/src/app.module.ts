import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JarvisGateway } from './gateway/jarvis.gateway';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, JarvisGateway],
})
export class AppModule {}
